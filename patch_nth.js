const fs = require('fs');
const p = 'd:/Arpit Sharma/Desktop/project 1/nb project/src/app/dashboard/reports/[managerId]/monthly/[month]/page.tsx';
let c = fs.readFileSync(p, 'utf8');

// Replace researcher table headers
const oldHeaders = `                            <NTh w={110}>Researcher</NTh>
                                <NTh w={120}>No. of Approved cases(RTC)</NTh>
                                <NTh w={120}>Average rating of the cases</NTh>
                                <NTh w={120}>No. of Approved cases(FOIA)</NTh>
                                <NTh w={130}>Expected Target of RTC</NTh>
                                <NTh w={140}>Expected Number of FOIA to be pitched?</NTh>
                                <NTh w={140}>Actual Number of FOIA pitched?</NTh>
                                <NTh w={110}>FOIA received?</NTh>
                                <NTh w={180}>Overall Remarks</NTh>`;

const newHeaders = `                            <NTh colIndex={0}>Researcher</NTh>
                                <NTh colIndex={1}>No. of Approved cases(RTC)</NTh>
                                <NTh colIndex={2}>Average rating of the cases</NTh>
                                <NTh colIndex={3}>No. of Approved cases(FOIA)</NTh>
                                <NTh colIndex={4}>Expected Target of RTC</NTh>
                                <NTh colIndex={5}>Expected Number of FOIA to be pitched?</NTh>
                                <NTh colIndex={6}>Actual Number of FOIA pitched?</NTh>
                                <NTh colIndex={7}>FOIA received?</NTh>
                                <NTh colIndex={8}>Overall Remarks</NTh>`;

c = c.replace(oldHeaders, newHeaders);

// Replace overview table headers - use .map() approach, replace the whole map with individual NTh
c = c.replace(
    `                                {["Monthly Overview","Total no. of cases(RTC)","Average case rating","Total No. of cases(FOIA)","Total expected target(RTC)","Total expected FOIA to be pitched","Total number of FOIA pitched?","Total no. of FOIA received?","Monthly Deadline completed or not?"].map(h => (
                                    <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold text-white bg-[#1a4a3a] border border-[#2a5a4a] leading-tight">{h}</th>
                                ))}`,
    `                                <NTh colIndex={0} overview>Monthly Overview</NTh>
                                <NTh colIndex={1} overview>Total no. of cases(RTC)</NTh>
                                <NTh colIndex={2} overview>Average case rating</NTh>
                                <NTh colIndex={3} overview>Total No. of cases(FOIA)</NTh>
                                <NTh colIndex={4} overview>Total expected target(RTC)</NTh>
                                <NTh colIndex={5} overview>Total expected FOIA to be pitched</NTh>
                                <NTh colIndex={6} overview>Total number of FOIA pitched?</NTh>
                                <NTh colIndex={7} overview>Total no. of FOIA received?</NTh>
                                <NTh colIndex={8} overview>Monthly Deadline completed or not?</NTh>`
);

fs.writeFileSync(p, c, 'utf8');

const headersFixed = c.includes('colIndex={0}>Researcher');
const overviewFixed = c.includes('colIndex={0} overview>Monthly Overview');
console.log('Researcher headers:', headersFixed);
console.log('Overview headers:', overviewFixed);
