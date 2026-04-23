import { renderBoardGrid, renderBoardHead } from "../../../render.js";

export function renderTimetableBoard(targets, options = {}) {
  const {
    headRoot,
    gridRoot,
  } = targets;

  const {
    matrix = [],
  } = options;

  renderBoardHead(headRoot);
  renderBoardGrid(gridRoot, matrix);
}
