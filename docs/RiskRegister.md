# Risk Register

## Active Risks

| ID | Severity | Risk | Mitigation | Status |
|----|----------|------|------------|--------|
| R1 | HIGH | Script load order change may cause undefined references | Maintained strict dependency order in index.html; all scripts are synchronous | Mitigated |
| R2 | HIGH | Patch merging may lose final-effective-version logic | Created Patch Chain End-Version Table; verified each merge against line numbers | Mitigated |
| R3 | MEDIUM | CSS extraction may lose specificity ordering | All CSS preserved in original order within main.css | Mitigated |
| R4 | MEDIUM | Global variable references may break across files | All modules still use window.TU namespace; no ES modules yet | Mitigated |
| R5 | LOW | Dead code removal may remove actually-used code | Each removal backed by grep evidence (0 references) | Mitigated |
| R6 | MEDIUM | TileLogicEngine worker blob URL may differ | Worker source generated identically from static method | Mitigated |
| R7 | LOW | Loading screen timing may differ slightly | Same DOM structure and animation preserved | Accepted |
| R8 | MEDIUM | Save format compatibility | SaveSystem code unchanged; same KEY and encoding | Mitigated |

## Closed Risks
None yet (first phase).

## Risk Assessment Methodology
- **HIGH**: Could cause game-breaking bugs or data loss
- **MEDIUM**: Could cause visual/UX regression
- **LOW**: Minor or unlikely impact
