const fs = require('fs');
const p = 'd:/Arpit Sharma/Desktop/project 1/nb project/src/app/api/reports/[managerId]/monthly/[month]/route.ts';
let c = fs.readFileSync(p, 'utf8');

// GET: add nishant fields to response
c = c.replace(
    `                // Section 7
                remark:              report.remark,
            },`,
    `                // Section 7
                remark:              report.remark,
                // Nishant Bhatia researcher monthly format
                nishantResearcherRows: report.nishantResearcherRows,
                nishantOverview:       report.nishantOverview,
            },`
);

// POST payload: add nishant fields
c = c.replace(
    `            // Section 7: Remark
            remark:              fields.remark              ?? null,`,
    `            // Section 7: Remark
            remark:              fields.remark              ?? null,
            // Nishant Bhatia researcher monthly format
            nishantResearcherRows: fields.nishantResearcherRows ?? null,
            nishantOverview:       fields.nishantOverview       ?? null,`
);

fs.writeFileSync(p, c, 'utf8');
console.log('API updated:', c.includes('nishantResearcherRows'));
