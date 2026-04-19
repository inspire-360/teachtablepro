import { escapeHtml } from "../common/html.js";

function buildHeroMetaItem(label, value, detail = "") {
  return `
    <article class="hero-meta-item">
      <span class="hero-meta-label">${escapeHtml(label)}</span>
      <strong class="hero-meta-value">${escapeHtml(value)}</strong>
      ${detail ? `<small class="hero-meta-detail">${escapeHtml(detail)}</small>` : ""}
    </article>
  `;
}

function ensureHeroMetaStrip(root) {
  let metaStrip = root.querySelector("[data-dashboard-hero-meta]");

  if (!metaStrip) {
    metaStrip = document.createElement("div");
    metaStrip.className = "hero-meta-strip";
    metaStrip.dataset.dashboardHeroMeta = "true";
    root.querySelector(".hero-copy")?.append(metaStrip);
  }

  return metaStrip;
}

export function renderDashboardHero(root, snapshot = {}) {
  if (!root) {
    return;
  }

  const kicker = root.querySelector(".eyebrow");
  const title = root.querySelector(".tt-display");
  const body = root.querySelector(".hero-text");
  const metaStrip = ensureHeroMetaStrip(root);

  const completionRate = Math.max(0, Math.min(snapshot.completionRate || 0, 100));
  const assignedPeriods = snapshot.assignedPeriods || 0;
  const requiredPeriods = snapshot.requiredPeriods || 0;
  const unresolvedCount = snapshot.unresolvedCount || 0;
  const alertCount = snapshot.alertCount || 0;
  const activeUsers = snapshot.activeUsers || 0;
  const filteredLabel = snapshot.filteredLabel || "ทุกระดับชั้น";
  const syncLabel = snapshot.syncLabel || "รอการซิงก์ครั้งแรก";

  if (kicker) {
    kicker.textContent = "Control Room";
  }

  if (title) {
    title.textContent = `พร้อมตัดสินใจเรื่องตารางสอนของ ${filteredLabel}`;
  }

  if (body) {
    body.textContent = `คาบที่จัดแล้ว ${assignedPeriods}/${requiredPeriods} คาบ เหลือกลุ่มที่ยังไม่ลงคาบ ${unresolvedCount} กลุ่ม และยังมีประเด็นที่ควรไล่ตรวจ ${alertCount} รายการ`;
  }

  metaStrip.innerHTML = [
    buildHeroMetaItem("ความพร้อม", `${completionRate}%`, "ภาพรวมล่าสุด"),
    buildHeroMetaItem("กลุ่มค้างจัด", unresolvedCount, "ต้องลงคาบต่อ"),
    buildHeroMetaItem("ประเด็นค้าง", alertCount, "ควรตรวจสอบ"),
    buildHeroMetaItem("ผู้ใช้ออนไลน์", activeUsers, syncLabel),
  ].join("");
}
