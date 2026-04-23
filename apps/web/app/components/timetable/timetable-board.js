import { renderBoardGrid, renderBoardHead } from "../../../render.js";

export function renderTimetableBoard(targets, options = {}) {
  const {
    headRoot,
    gridRoot,
  } = targets;

  const {
    boardModel = { columns: [], rows: [] },
  } = options;

  renderBoardHead(headRoot, boardModel);
  renderBoardGrid(gridRoot, boardModel);
}
