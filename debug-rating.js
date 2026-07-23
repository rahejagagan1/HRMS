const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function run() {
    const writerId = 496; // Gauri
    const monthPeriod = "2026-02";
    
    // Exactly replicate what the calculator does
    const managerRating = await p.managerRating.findFirst({
        where: {
            userId: writerId,
            period: monthPeriod,
            periodType: "monthly",
        },
        orderBy: { submittedAt: "desc" },
    });

    console.log("Found managerRating:", !!managerRating);
    console.log("Has ratingsJson:", !!managerRating?.ratingsJson);
    
    if (managerRating?.ratingsJson) {
        const managerRatings = managerRating.ratingsJson;
        console.log("Type of ratingsJson:", typeof managerRatings);
        console.log("All keys:", Object.keys(managerRatings));
        
        // Script Q values
        const scriptQKeys = ["script_q1", "script_q2", "script_q3", "script_q4", "script_q5"];
        const scriptQValues = scriptQKeys.map(k => managerRatings[k]).filter(v => v != null && !isNaN(v));
        console.log("Script Q raw values:", scriptQKeys.map(k => ({ key: k, val: managerRatings[k], type: typeof managerRatings[k] })));
        console.log("Script Q filtered values:", scriptQValues);
        console.log("Script Q length:", scriptQValues.length);
        
        if (scriptQValues.length > 0) {
            const avg = scriptQValues.reduce((s, v) => s + v, 0) / scriptQValues.length;
            console.log("Script avg:", avg);
        }
        
        // Ownership Q values
        const ownerQKeys = ["ownership_q1", "ownership_q2", "ownership_q3", "ownership_q4", "ownership_q5"];
        const ownerQValues = ownerQKeys.map(k => managerRatings[k]).filter(v => v != null && !isNaN(v));
        console.log("Owner Q raw values:", ownerQKeys.map(k => ({ key: k, val: managerRatings[k], type: typeof managerRatings[k] })));
        console.log("Owner Q filtered:", ownerQValues);
        console.log("Owner Q length:", ownerQValues.length);
    }
}

run().catch(console.error).finally(() => p.$disconnect());
