function findOptimalGroups(matrix) {
  const n = matrix.length;
  const m = matrix[0].length;
  const groups = [];
  let currentGroupValue = 2;

  // helper function to check if a cell is valid for a group
  function isValid(cell) {
    if (cell.row < 0 || cell.row >= n || cell.col < 0 || cell.col >= m) {
      return false;
    }
    if (matrix[cell.row][cell.col] === 1) {
      return false;
    }
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (group.value % 2 === currentGroupValue % 2) {
        if (group.cells.some(c => isAdjacent(c, cell))) {
          return false;
        }
      }
    }
    return true;
  }

  
    // helper function to check if two cells are adjacent
    function isAdjacent(cell1, cell2) {
      return Math.abs(cell1.row - cell2.row) <= 1 && Math.abs(cell1.col - cell2.col) <= 1;
    }

  // main loop
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < m; col++) {
      if (matrix[row][col] === 0) {
        continue; // skip cells that are already covered
      }

      // check if the cell has any adjacent cells that are already covered
      let hasAdjacentCoveredCell = false;
      for (let i = row - 1; i <= row + 1; i++) {
        for (let j = col - 1; j <= col + 1; j++) {
          if (i >= 0 && i < n && j >= 0 && j < m && matrix[i][j] === 0) {
            hasAdjacentCoveredCell = true;
            break;
          }
        }
        if (hasAdjacentCoveredCell) {
          break;
        }
      }

      // if the cell has adjacent covered cells, add it to an existing group or create a new group
      if (hasAdjacentCoveredCell) {
        let canAddToExistingGroup = false;
        for (let i = 0; i < groups.length; i++) {
          const group = groups[i];
          if (group.cells.length < 6 && group.cells.some(c => isAdjacent(c, { row, col }))) {
            if (isValid({ row, col })) {
              group.cells.push({ row, col });
              canAddToExistingGroup = true;
              break;
            }
          }
        }
        if (!canAddToExistingGroup) {
          const newGroup = { value: currentGroupValue, cells: [{ row, col }] };
          groups.push(newGroup);
          currentGroupValue++;
        }
      }
    }
  }

  return groups;
}