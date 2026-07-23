# NB Media — Offer Letter Template (Source of Truth)

> Verbatim transcription of `Revised-Offer-Letter-Format.pdf` as supplied by HR.
> Implemented in `src/lib/offer-letter.ts` — when "Generate offer letter" is
> clicked in the New Offer modal, the 9 highlighted placeholders are substituted.

## Letterhead (printed only — not editable in the textarea)

```
YT Money Productions Pvt. Ltd.
Registered Office: 1st Floor, 209, NB Media,
Model Town, Main Road, Phase 2,
Bathinda, Punjab, 151001
Phone: 8146891380
Email: HRD@nbmediaproductions.com
CIN: U92113PB2022PTC055026

[NB MEDIA LOGO — top-right]

NOTE:
This is a temporary / Conditional offer and cannot be used for Negotiations with other companies.
```

## Placeholders that get substituted on Generate

| # | Placeholder in PDF       | Where it comes from in NB Dashboard           |
|---|--------------------------|------------------------------------------------|
| 1 | Letter date              | `today` (date the offer is generated)         |
| 2 | `Candidate Name`         | Candidate's `fullName`                        |
| 3 | Application date         | Candidate's `createdAt`                       |
| 4 | `Job Role`               | The "Job role for this offer" input           |
| 5 | Joining date `DD/MM/YYYY`| The "Joining date" input                      |
| 6 | Reporting time `10:00 AM`| Constant — printed verbatim                   |
| 7 | Confirmation deadline    | The "Expires on" input                        |
| 8 | Annual CTC `XX LPA`      | The "Annual CTC (₹)" input → converted to LPA |
| 9 | Annexure A pay breakdown | Auto-computed from CTC (see formula below)    |

## Pay breakdown formula (Annexure A)

Annual CTC is divided into monthly gross, then split:

| Component             | Formula                                       |
|-----------------------|------------------------------------------------|
| Basic Pay             | 40% of monthly gross                          |
| House Rent Allowance  | 50% of Basic                                  |
| Dearness Allowance    | 0 (no DA in private structure)                |
| Conveyance Allowance  | ₹1,600 capped                                 |
| Medical Allowance     | ₹1,250 capped                                 |
| Special Allowance     | Monthly gross − (sum of all above)            |
| **Total Monthly CTC** | Monthly gross (= Annual CTC ÷ 12)             |

When HR enters ₹600,000 annual:
- Monthly gross = ₹50,000
- Basic = ₹20,000
- HRA = ₹10,000
- Conveyance = ₹1,600
- Medical = ₹1,250
- Special = ₹17,150
- **Total = ₹50,000**

The breakdown is editable in the printable PDF — HR can override any line
before printing.

## Letter Of Offer (page 1)

```
{{letterDate}}

Dear "{{candidateName}}"

With reference to your application dated "{{applicationDate}}" and subsequent
interview with us, we are pleased to offer you employment for the position of
"{{jobRole}}" with YT Money Productions Pvt. Ltd. (operating under the brand
name NB Media). We trust that your knowledge, skills, and experience will be
among our most valuable assets.

Annexure "A" below includes your salary and benefits information and Annexure
"B" includes your joining requirement information.

Your signing of these documents confirms your acceptance of the terms and
conditions.

Joining Date: {{joiningDate}}
Reporting Time: 10:00 AM
Location: Cyber Cube, C 201- 202, Phase 8B, Industrial Area, Sector 74,
Sahibzada Ajit Singh Nagar, Mohali Punjab 160055
Employment Type: Full-Time
Working Hours: 09:00 AM to 6.00 PM (Monday to Friday)
*Please note that Saturdays are flexi-offs.

Kindly acknowledge your acceptance by signing the document, and confirming the
joining date by {{acceptanceDeadline}}.
Failure to accept prior to the specified deadline will render this offer null
and void automatically.

For any further questions or concerns feel free to reach us.

We extend our heartfelt wishes for an exceptional tenure aboard!

Regards,
Nikit Bassi
Founder & CEO
```

## Terms and Conditions (pages 2–3)

Static legal boilerplate — 25 numbered clauses. Stored verbatim in
`src/lib/offer-letter.ts` as the `TERMS_AND_CONDITIONS` constant. Only the
`{{jobRole}}` reference in the heading gets substituted.

Clauses cover: probation period, minimum tenure, salary structure
confidentiality, working hours, code of conduct, full-time exclusivity,
intellectual property, leaves, notice period, retirement age, BG verification,
non-compete, indemnity, jurisdiction (Bathinda courts), document requirements.

## Acceptance & Background Verification (page 4)

```
Acceptance:
I "{{candidateName}}" hereby accept your offer, subject to the conditions
mentioned above and shall join my duties on "{{joiningDate}}".

Background Verification:
I hereby give my consent for background verification. I understand that the
issuance of this offer letter or appointment letter is subject to satisfactory
references and background verification. In case any declaration given or
information furnished by me proves to be false, or if I am found to have
willfully suppressed or concealed any material fact, this offer shall be
deemed to be null and void.

Name: _______________________
Signature: _______________________
Address: _______________________
Date: _______________________
```

## Annexure A — Compensation Structure (REMOVED)

> **Not included in the generated offer letter.** Candidates don't see
> a CTC breakdown on the formal letter — package specifics are
> communicated separately (verbally or in a follow-up note).
>
> HR still captures `ctcAnnual` in the New Offer form for record-keeping;
> the value never appears on the PDF the candidate receives.

Historical reference (for context, not rendered):

## ~~Annexure A — Compensation Structure~~ (page 4–5)

```
Your Annual fixed compensation of Rs. {{annualLPA}} LPA will be divided per the
following break up:

FIXED MONTHLY PAY:
+--------------------------+-----------+
| PAY COMPONENT            | MONTHLY   |
+--------------------------+-----------+
| Basic Pay                | Rs. XXXX  |
| House Rent Allowance     | Rs. XXXX  |
| Dearness Allowance       | Rs. XXXX  |
| Conveyance Allowance     | Rs. 1,600 |
| Medical Allowance        | Rs. 1,250 |
| Special Allowance        | Rs. XXXX  |
| TOTAL MONTHLY CTC        | Rs. XXXX  |
+--------------------------+-----------+

Note:
- You will also be eligible to receive additional bonus amounts, subject to your
  job performance at NB Media.
- No bonus, whatsoever, shall be payable in the event of resignation by an
  employee.
- Applicable taxes (if any) would be borne by the employee.
```

## Annexure B — Joining Documents (page 5–6)

Static checklist of 11 required documents at joining (Education certs, CV,
photos, PAN, Aadhaar, etc.). Stored verbatim in `offer-letter.ts` as
`JOINING_DOCUMENTS`.

Closing line: "In case of any query related to the joining process, please
feel free to get in touch with us at HR_CONTACT_EMAIL." — substitutes the
configured HR contact email (currently Vanshika).
