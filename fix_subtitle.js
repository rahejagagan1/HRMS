const fs = require('fs');
const p = 'd:/Arpit Sharma/Desktop/project 1/nb project/src/app/dashboard/reports/[managerId]/page.tsx';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
    '{submittedMap[`week-${week}-${index}`] ? "Submitted" : "Writers & editors"}',
    '{submittedMap[`week-${week}-${index}`] ? "Submitted" : manager?.name?.toLowerCase().includes("nishant") ? "Researchers" : "Writers & editors"}'
);

fs.writeFileSync(p, c, 'utf8');
console.log('Done:', c.includes('Researchers'));
