## 2024-04-09 - [Optimize Array Filtering passes]
**Learning:** Avoid chained `Array.prototype.filter()` calls which create intermediate arrays and iterate over the collection multiple times. Using a single `filter` pass with combined boolean conditions and early returns significantly reduces memory allocation overhead and computational complexity.
**Action:** Always refactor sequential `.filter()` chains into a single pass when optimizing data processing.
