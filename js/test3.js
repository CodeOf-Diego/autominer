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
  
    // helper function to get the number of 1 cells covered by a group
    function getCoveredCount(group) {
      let count = 0;
      for (let i = 0; i < group.cells.length; i++) {
        const cell = group.cells[i];
        for (let row = cell.row - 1; row <= cell.row + 1; row++) {
          for (let col = cell.col - 1; col <= cell.col + 1; col++) {
            if (row >= 0 && row < n && col >= 0 && col < m && matrix[row][col] === 1) {
              count++;
            }
          }
        }
      }
      return count;
    }
  
    // helper function to add a new group
    function addGroup(cells) {
      groups.push({ value: currentGroupValue, cells });
      currentGroupValue++;
    }
  
    /* 1 risposta terminata a meta
    // // main loop
    // for (let row = 0; row < n; row++) {
    //   for (let col = 0; col < m; col++) {
    //     if (matrix[row][col] === 1) {
    //       continue;
    //     }
    //     let adjacentGroups = [];
    //     for (let i = 0; i < groups.length; i++) {
    //       const group = groups[i];
    //       if (group.value % 2 === currentGroupValue % 2) {
    //         if (group.cells.some(c => isAdjacent(c, { row, col }))) {
    //           adjacentGroups.push(group);
    //         }
    //       }
    //     }
    //     if (adjacentGroups.length > 0) {
    //       const bestGroup = adjacentGroups.reduce((best, group) => {
    //         const newCells = group.cells.concat([{ row, col }]);
    //         if (newCells.length <= 6 && isValid({ row, col })) {
    //           const newGroup = { value: group.value, cells: newCells };
    //           if (getCoveredCount(newGroup) > getCoveredCount(best)) {
    //             return newGroup;
    //           }
    //         }
    //         return best;
    //       }, { value: 0, cells: [] });
    //       if (bestGroup.cells.length > 0) {
    //         const index = groups.indexOf(bestGroup);
    //         if (index >= 0) {
    //           groups.splice(index, 1);
    //         }
    //         bestGroup.cells.forEach(cell => matrix[cell.row][cell.col] = bestGroup.value);
    //         groups.push(bestGroup);
    //       }
    //     } else {
    //       const
*/



































           // main loop
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < m; col++) {
      if (matrix[row][col] === 1) {
        continue; // skip cells that are already covered
      }

      // check if the cell can be added to an existing group
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

      // if the cell cannot be added to an existing group, create a new group for it
      if (!canAddToExistingGroup) {
        const newGroup = { value: currentGroupValue, cells: [{ row, col }] };
        groups.push(newGroup);
        currentGroupValue++;
      }
    }
  }

  return groups;
}