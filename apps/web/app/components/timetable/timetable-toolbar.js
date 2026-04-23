export function renderTimetableToolbar(targets, options = {}) {
  const {
    scopeTitle,
    scopeMeta,
    boardKicker,
    boardTitle,
    boardNote,
  } = targets;

  const {
    currentViewLabel = "มุมมองห้องเรียน",
    currentScopeLabel = "-",
    entryCount = 0,
    occupiedSlotCount = 0,
    unresolvedGroupCount = 0,
    validationCount = 0,
    selectedGroupLabel = "",
    suggestionCount = 0,
    suggestionsState = "idle",
    suggestionsError = "",
    collaborationStatus = "idle",
    collaborationMessage = "",
  } = options;

  let note = validationCount > 0
    ? `ยังมีประเด็นตรวจสอบ ${validationCount} รายการ และมีกลุ่มค้างจัด ${unresolvedGroupCount} กลุ่มในขอบเขตนี้`
    : `พร้อมลากกลุ่มการสอนลงคาบ โดยตอนนี้เหลือกลุ่มค้างจัด ${unresolvedGroupCount} กลุ่ม`;

  if (selectedGroupLabel) {
    if (suggestionsState === "loading") {
      note = `กำลังวิเคราะห์ช่องที่เหมาะสำหรับ ${selectedGroupLabel}`;
    } else if (suggestionsState === "error") {
      note = suggestionsError || `ยังโหลดคำแนะนำสำหรับ ${selectedGroupLabel} ไม่สำเร็จ`;
    } else if (suggestionCount > 0) {
      note = `พบช่องแนะนำ ${suggestionCount} ช่องสำหรับ ${selectedGroupLabel} เลือกจากแผงขวาหรือลากลงกระดานได้ทันที`;
    } else {
      note = `ยังไม่พบช่องที่เหมาะสำหรับ ${selectedGroupLabel} กรุณาตรวจช่วงเวลาว่าง ครู ห้อง และ lock ปัจจุบัน`;
    }
  }

  if ((collaborationStatus === "attention" || collaborationStatus === "reconnecting") && collaborationMessage) {
    note = collaborationMessage;
  }

  scopeTitle.textContent = `ตารางสอนของ ${currentScopeLabel}`;
  scopeMeta.textContent = `${currentViewLabel} โดยลงคาบแล้ว ${entryCount} รายการ ใช้งาน ${occupiedSlotCount} ช่อง`;
  boardKicker.textContent = currentViewLabel;
  boardTitle.textContent = `กระดานจัดตารางของ ${currentScopeLabel}`;
  boardNote.textContent = note;
  boardNote.dataset.defaultText = note;
}
