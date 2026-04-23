const crypto = require("node:crypto");
const https = require("node:https");

const GOOGLE_CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const DEFAULT_PROJECT_ID = "teachtable-pro";

let certificateCache = {
  expiresAt: 0,
  certificates: new Map(),
};

function getProjectId() {
  return process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
}

function readBearerToken(headers = {}) {
  const headerValue = headers.authorization || headers.Authorization || "";
  const [scheme, token] = headerValue.split(" ");
  if (scheme !== "Bearer" || !token) {
    return "";
  }
  return token.trim();
}

function decodeBase64Url(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function parseJsonSegment(segment, label) {
  try {
    return JSON.parse(decodeBase64Url(segment).toString("utf8"));
  } catch {
    throw new Error(`โทเค็น Firebase ส่วน ${label} ไม่ถูกต้อง`);
  }
}

function getCacheMaxAge(cacheControl) {
  const match = /max-age=(\d+)/i.exec(cacheControl || "");
  return match ? Number(match[1]) * 1000 : 60 * 60 * 1000;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`ไม่สามารถโหลดใบรับรอง Firebase ได้ (${response.statusCode})`));
          return;
        }

        try {
          resolve({
            body: JSON.parse(body),
            headers: response.headers,
          });
        } catch {
          reject(new Error("ข้อมูลใบรับรอง Firebase ไม่ได้อยู่ในรูปแบบ JSON ที่ถูกต้อง"));
        }
      });
    });

    request.on("error", () => {
      reject(new Error("ไม่สามารถเชื่อมต่อบริการใบรับรองของ Firebase ได้"));
    });
  });
}

async function loadCertificates(forceRefresh = false) {
  if (!forceRefresh && Date.now() < certificateCache.expiresAt && certificateCache.certificates.size > 0) {
    return certificateCache.certificates;
  }

  const response = await fetchJson(GOOGLE_CERT_URL);
  const expiresAt = Date.now() + getCacheMaxAge(response.headers["cache-control"]);

  certificateCache = {
    expiresAt,
    certificates: new Map(Object.entries(response.body)),
  };

  return certificateCache.certificates;
}

function validatePayload(payload) {
  const projectId = getProjectId();
  const issuer = `https://securetoken.google.com/${projectId}`;
  const now = Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId) {
    throw new Error("โทเค็น Firebase นี้ถูกออกให้กับโปรเจกต์อื่น");
  }

  if (payload.iss !== issuer) {
    throw new Error("ไม่รู้จักผู้ออกโทเค็น Firebase นี้");
  }

  if (!payload.sub || typeof payload.sub !== "string" || payload.sub.length > 128) {
    throw new Error("ข้อมูลผู้ใช้ในโทเค็น Firebase ไม่ถูกต้อง");
  }

  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new Error("เซสชัน Firebase หมดอายุแล้ว");
  }

  if (typeof payload.iat !== "number" || payload.iat > now + 300) {
    throw new Error("เวลาออกโทเค็น Firebase ไม่ถูกต้อง");
  }

  if (payload.auth_time && typeof payload.auth_time === "number" && payload.auth_time > now + 300) {
    throw new Error("เวลายืนยันตัวตนของ Firebase ไม่ถูกต้อง");
  }
}

async function verifyFirebaseIdToken(idToken) {
  const segments = String(idToken || "").split(".");
  if (segments.length !== 3) {
    throw new Error("รูปแบบโทเค็น Firebase ไม่ถูกต้อง");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = parseJsonSegment(encodedHeader, "header");
  const payload = parseJsonSegment(encodedPayload, "payload");

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("โทเค็น Firebase ใช้อัลกอริทึมการลงนามที่ไม่รองรับ");
  }

  validatePayload(payload);

  let certificates = await loadCertificates();
  let certificate = certificates.get(header.kid);
  if (!certificate) {
    certificates = await loadCertificates(true);
    certificate = certificates.get(header.kid);
  }

  if (!certificate) {
    throw new Error("ไม่พบใบรับรองสำหรับตรวจสอบลายเซ็นของ Firebase");
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  const signature = decodeBase64Url(encodedSignature);
  const isValid = verifier.verify(certificate, signature);
  if (!isValid) {
    throw new Error("ลายเซ็นของโทเค็น Firebase ไม่ถูกต้อง");
  }

  return {
    uid: payload.user_id || payload.sub,
    email: payload.email || "",
    name: payload.name || payload.email || payload.sub,
    picture: payload.picture || "",
    emailVerified: Boolean(payload.email_verified),
    provider: payload.firebase?.sign_in_provider || "",
    claims: payload,
  };
}

async function authenticateApiRequest(req) {
  const idToken = readBearerToken(req.headers);
  if (!idToken) {
    return {
      ok: false,
      message: "กรุณาเข้าสู่ระบบก่อนใช้งาน TeachTable",
    };
  }

  try {
    const user = await verifyFirebaseIdToken(idToken);
    return { ok: true, user };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "เซสชันของคุณไม่สามารถใช้งานต่อได้แล้ว",
    };
  }
}

module.exports = {
  authenticateApiRequest,
  getProjectId,
};
