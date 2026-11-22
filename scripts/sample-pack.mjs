// The sample Bid Draft Pack page (sample-pack/).
//
// One worked example of what a pack looks like: a compliance checklist, a
// response outline and first-draft answers, made from a single public tender
// document that its publisher released under CC BY 4.0. The bidder is made up.
//
// Rules for anything added here:
//   - Only restate what the source document says, with its section number.
//     Where the document does not say something, say that it does not.
//   - The page must keep saying that it is a sample, that the bidder is
//     invented, that nothing is promised, and how the pack was made.
//   - Keep the attribution wording exactly as the source asks for it.

export const SOURCE = {
  // The licence page of the document says how it must be attributed.
  attribution: "Exposure Draft of the 2025 National Panel of Assessors program RFT",
  title: "Request for Tender – National Panel of Assessors 2025-2028 (Exposure Draft)",
  publisher: "Department of Social Services",
  released: "August 2024",
  url: "https://engage.dss.gov.au/wp-content/uploads/2024/08/Request-for-Tender-Exposure-Draft-National-Panel-of-Assessors-FINAL.pdf",
  licence: "Creative Commons Attribution 4.0 International",
  licenceShort: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
};

export const BIDDER = "Example Workplace Assessments Pty Ltd";

export const STATUSES = { ready: "Ready", todo: "To do", check: "Check", na: "Not applicable" };

const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Text with [CHECK: …] flags, which are shown highlighted.
const flagged = (s) => escape(s).replace(/\[CHECK: ([^\]]+)\]/g, '<mark class="chk">Check: $1</mark>');

// ---------- the tender at a glance ----------

export const GLANCE = [
  ["Buyer", "Department of Social Services (the draft calls it “the department”)."],
  [
    "What is being bought",
    "Places on a panel of providers who carry out three kinds of assessment for people with disability at work: Ongoing Support Assessments (OSA), Supported Wage System (SWS) assessments and Workplace Modifications Services (WMS) assessments, including specialist WMS. A bid can cover OSA and SWS together, or WMS, or both (section 1.1.1 and section 2).",
  ],
  [
    "Form of contract",
    "A Deed of Standing Offer from 1 July 2025 to 30 June 2028, which the department may extend by up to three more years. No fee is paid for being appointed, and the department makes no commitment about the amount of work (section 1).",
  ],
  [
    "Where",
    "The draft counts 110 Employment Service Areas across Australia, with Norfolk Island still to be confirmed. A bidder can offer a whole area or part of one, listing postcodes, and must be able to deliver face to face in every area it offers (section 3, under “Employment Service Areas” and “Coverage”).",
  ],
  [
    "Price",
    "Payment is fee for service, on the department's schedule. The draft's Table 2 proposes, including GST: $475.36 for an OSA; $679.10 for an SWS assessment; $135.82 an hour for WMS, up to 5 hours; $56.59 an hour for travel on return trips of more than 200 km. Fees are indexed each 1 July, first on 1 July 2026 (section 2.8.1).",
  ],
  [
    "How to respond",
    "Through AusTender only (section 8.14). Answers to the selection criteria are typed into the AusTender lodgement system, within word limits that the tender form sets (section 4). The draft does not give the limits.",
  ],
  [
    "How bids are judged",
    "In six stages: screening; assessment against the selection criteria, each on its own; a Right Fit For Risk (information security) assessment; financial viability; a value for money comparison; then negotiation and decision. The draft states no weightings (section 5.1).",
  ],
  [
    "Timetable in the draft",
    "From its indicative timeline: the draft released on 30 August 2024; comments by 27 September 2024; the final tender released in October or November 2024 and closing in November or December 2024; outcomes in March 2025; services starting 1 July 2025.",
  ],
];

// ---------- part 1: compliance checklist ----------
// [section in the draft, requirement, what to provide or do, status for the invented bidder, note on that status]

export const CHECKLIST = [
  {
    heading: "Conditions for participation",
    note: "Section 3.1. A bidder that fails any one of these is excluded.",
    rows: [
      ["3.1", "Be a legal entity that can enter into the Deed at the closing time.", "Proof of entity type is a required attachment, except from existing providers (section 8.14.9).", "ready", "A proprietary company."],
      [
        "3.1, Table 3",
        "Hold a valid and satisfactory Statement of Tax Record at closing, or a receipt showing it has been requested from the Australian Taxation Office, with the statement in hand within 4 business days of closing.",
        "Request it early. Table 3 sets out what each business structure needs (company, partnership, trust, joint venture, consolidated group, GST group).",
        "todo",
        "Not yet requested.",
      ],
      ["3.1", "Hold a Statement of Tax Record for any first-tier subcontractor whose work is estimated at more than $4 million including GST.", "Estimate each subcontractor's share before deciding.", "na", "Two contract assessors, far below that value."],
      [
        "3.1, 8.3.6",
        "Not be named as failing to comply with the Workplace Gender Equality Act 2012.",
        "Declare whether the business is a “relevant employer” under that Act. If it is, provide a current letter of compliance with the tender or before entering into a Deed.",
        "check",
        "14 staff. Confirm whether the Act treats the business as a relevant employer.",
      ],
      ["3.1, 8.3.7", "Not be on the United Nations consolidated sanctions list. This extends to personnel.", "A declaration covering the bidder and any proposed subcontractors.", "todo", "Declaration to be signed."],
      ["3.1", "Have no court or tribunal decision for unpaid employee entitlements that is still unpaid (decisions under appeal are left out).", "Confirm with whoever holds the company's legal records.", "check", "None known. Confirm."],
    ],
  },
  {
    heading: "Minimum content and format",
    note: "Section 3, under “Minimum content and format requirements”. A tender that misses any of these is excluded.",
    rows: [
      ["3, minimum content", "The tender is in English.", "Nothing further.", "ready", ""],
      ["3, minimum content", "The tender gives a current, valid ABN (each member's, for a group).", "Check the ABN is active and in the bidding entity's name.", "ready", ""],
      ["3, minimum content", "The tender includes the Statement of Tax Record, or the receipt for the request.", "As above.", "todo", "Depends on the request above."],
      ["3, minimum content; 8, Modern slavery", "The tender says how the bidder will identify, assess and address modern slavery risks.", "A short statement written for this tender. Once appointed, a provider can also be required to supply modern slavery information within 10 business days of a written request.", "todo", "Nothing written yet."],
    ],
  },
  {
    heading: "Forms and attachments",
    note: "Only documents the tender asks for are accepted, and an attachment that is not on the template provided can make a tender non-compliant (section 8.14.9).",
    rows: [
      ["4, 8.14.6", "Answers to the selection criteria, typed into the AusTender lodgement system, within the word limits the tender form sets.", "See Part 2 and Part 3. The limits are not in the draft: read them from the form before editing.", "todo", "First drafts below."],
      [
        "3, Coverage; Appendix D",
        "The Coverage of Service template: whether the bid is national or by Employment Service Area, the postcodes for a part area, and whether it includes specialist WMS.",
        "Decide the areas first. An offer in one area can be made conditional on winning another (section 3.4.1). The department says it intends its own offers of business to be all or nothing.",
        "todo",
        "Two areas, no specialist WMS, no conditions.",
      ],
      [
        "6",
        "The Financial and Credentials Information Form, with financial statements for the last complete financial year: for the whole entity, with all notes, in Australian dollars.",
        "Audited statements are required from some kinds of entity and preferred from the rest. The form also asks about recent financial changes, court actions, and the ultimate holding entity and directors.",
        "check",
        "Statements are unaudited. Confirm that is acceptable for this company.",
      ],
      ["7.1.1", "The Right Fit For Risk Questionnaire, from any bidder without current accreditation.", "Complete and upload it with the tender.", "todo", "No accreditation held."],
      ["4; 8.3.9", "A draft environmental sustainability statement.", "It is assessed, along with the benefit of the tender to the Australian economy, in the value for money stage (section 5.1.5).", "todo", "Nothing written yet."],
      [
        "4",
        "At least one referee and at most two, with names and contact details, who can verify the claims made against the criteria.",
        "Current and former officers, staff, contractors and advisers of the department cannot be referees, nor can current or former ministerial advisers.",
        "todo",
        "Two clients to be asked.",
      ],
      ["8.14.9", "Details of subcontractors. For a group bid, details of each member and written confirmation of the lead member's authority (section 8.14.14).", "Required attachments where they apply.", "todo", "Two contract assessors to be listed."],
      [
        "8.12",
        "The Respondent Declaration, and the declarations on conflict of interest (section 8.12.2) and ethical dealing (section 8.12.4).",
        "Other public funding must be disclosed in section 14 of the Financial and Credentials Information Form (section 8.12.3).",
        "todo",
        "No conflict known. Declaration to be signed.",
      ],
      [
        "8.3.9 and the headings after it",
        "Procurement policy disclosures: whether the bidder is a large business under the Payment Times policy and, for contracts worth more than $200,000, its country of tax residency.",
        "The Indigenous Procurement Policy also applies to this procurement.",
        "check",
        "Not a large business. Confirm the wording the form uses.",
      ],
      ["8.14.6 to 8.14.13", "Lodge through AusTender before the closing time. Read every addendum first. Late tenders are not accepted, and a saved draft is not a lodged tender.", "Keep the receipt that AusTender emails.", "todo", ""],
    ],
  },
  {
    heading: "What the bidder must be able to do if appointed",
    note: "Not forms, but commitments the tender makes. Worth settling before any writing starts.",
    rows: [
      [
        "2.3.2",
        "Every assessor has at least 2 years' practical experience in disability employment, workplace productivity assessment or a related sector. OSA and SWS assessors hold a diploma or higher in psychology, rehabilitation counselling, vocational training or another field the department approves. WMS assessors hold full, current registration or recognition, for example as an occupational therapist, physiotherapist, nurse or medical practitioner (AHPRA), an exercise physiologist (Exercise and Sports Science Australia) or a rehabilitation counsellor (either of the two associations the draft names).",
        "Match each assessor to a service type and keep the evidence. The provider approves its own assessors and should tell the department when it engages a new one (section 2.3.1).",
        "check",
        "Seven assessors appear to qualify for WMS. Confirm which of them meet the OSA and SWS rule.",
      ],
      ["2; 3, Coverage", "Deliver assessments face to face in every area offered. Video needs the department's written approval and exceptional circumstances.", "Check travel times across each area offered.", "ready", ""],
      ["2.3.3", "The provider and each assessor complete the department's online OSA and SWS training before starting work. A provider that will only deliver WMS does not have to.", "Allow time before 1 July.", "todo", ""],
      ["1.1.1", "Never assess a person employed by the provider's own organisation or a related one.", "Explain the safeguard in the answer to Criterion 2.", "ready", "No related entities."],
      [
        "7.1",
        "Meet the Right Fit For Risk core expectations from the day services start (data kept in Australia including backups, staff vetting, and the Essential Eight security strategies, where Maturity Level 1 is the recommended starting level), reach the first milestone within 1 month and the second within 3 months, and be accredited within 9 months of the Deed starting.",
        "This is the largest piece of new work for a small practice. Cost it before bidding.",
        "check",
        "Records system is believed to be hosted in Australia. Confirm, including backups.",
      ],
      [
        "2.7.2",
        "Work to the proposed performance indicators: 90 per cent of assessments completed within the Deed's timeframes; 90 per cent of allocated assessments accepted, with reasons for every rejection; corrected reports within 5 business days (OSA and SWS) or 2 business days (WMS); 90 per cent of sampled reports accepted as complete.",
        "Compare with current turnaround times and say in the tender how they will be met.",
        "check",
        "Current median is 6 business days from referral to report. The Deed's timeframes were not in the draft.",
      ],
      ["8, Insurance", "Hold the insurance the Draft Deed specifies.", "The draft gives no types or amounts, and the Draft Deed (Appendix E) was not included in it.", "check", "Compare current cover with the Deed."],
      ["8.3.3", "Providers, staff and subcontractors who work with people with disability, elderly or otherwise vulnerable people, or children must arrange, undergo and pay for the required checks, including police checks.", "For every assessor, including contractors.", "check", "Held by employees. Confirm for the two contractors."],
    ],
  },
];

// ---------- part 2: response outline ----------

export const OUTLINE = [
  {
    name: "Criterion 1: Organisational capability",
    ref: "section 4.1.1",
    asks: [
      "How the bidder will deliver OSA and SWS and/or WMS assessment services.",
      "Its experience and performance in delivering similar services.",
      "How it will recruit and keep suitably qualified and experienced staff, and keep them trained, in the areas it has nominated.",
      "How it will build and keep cooperative relationships with a wide range of people: people with disability, employment service providers, health professionals, employers and union representatives.",
      "Its governance, communication, management and accountability arrangements for complying with the Deed.",
    ],
    plan: [
      "Open with one sentence saying which services and which areas the bid covers.",
      "Delivery: the path of one assessment from the allocated work order to the accepted report, with who does what and by when. Tie each step to a performance indicator in section 2.7.2.",
      "Experience: numbers for comparable work in the last two or three years, with one short worked example. Say plainly what has not been done before.",
      "Staff: who is employed now and their registrations, how gaps are covered, how registration and training are tracked.",
      "Relationships: named kinds of organisations already worked with in each area.",
      "Governance: who signs off reports, how complaints and conflicts are handled, who the department talks to.",
    ],
    evidence: ["Assessment counts by year and type", "Turnaround times from the practice system", "Staff list with registration numbers and expiry dates", "A de-identified sample report", "Organisation chart"],
  },
  {
    name: "Criterion 2: Quality",
    ref: "section 4.1.2",
    asks: [
      "How the work of all assessors, including subcontractors, will reach the quality the department requires.",
      "How the bidder is suitably qualified to work with people with disability, including people with high support needs.",
      "How its assessments will be independent and not unduly influenced by its other relationships, including where it or a related organisation provides services under the new specialist disability employment program.",
    ],
    plan: [
      "Quality system: how reports are reviewed before release, what is sampled afterwards, and what happens when a report is sent back.",
      "Subcontractors: the same rules, stated explicitly, and how they are checked.",
      "Working with people with high support needs: training, experience, and how an assessment is adapted.",
      "Independence: what other work the business does, who it is related to, and the rule for declining an allocation.",
    ],
    evidence: ["Peer review procedure and recent results", "Training records", "Complaints register (numbers only)", "Conflict of interest register and policy"],
  },
  {
    name: "Criterion 3: Specialist WMS",
    ref: "section 4.1.3",
    asks: [
      "Only for bidders offering specialist WMS, which the draft describes as assessment by someone with specialist skills in a particular disability. Its example is an assessor qualified to assess people with vision impairments.",
      "Experience and performance in specialist WMS or similar services, the group the bidder will serve, and its knowledge of that group's needs.",
    ],
    plan: ["A bidder that is not offering specialist WMS answers “not applicable”."],
    evidence: [],
  },
];

export const OUTLINE_RULES = [
  "Each criterion is assessed on its own, and the draft says all claims against a criterion must be made in that criterion's section (section 5.1.2). So a fact that supports two criteria has to be written twice.",
  "The department may use performance information it already holds, but the draft tells bidders not to rely on that and to give full performance information themselves (section 5.1.2).",
  "Section 4 tells bidders to answer with section 2 (the statement of requirements) and the Draft Deed in front of them, and says value for money is shown through the ability to provide effective assessments cost-effectively.",
  "Word limits are set in the tender form and cannot be exceeded. The drafts below are about 300 words each and would be cut or extended to the limits.",
];

// ---------- part 3: first-draft answers for an invented bidder ----------

export const BIDDER_FACTS = [
  "A proprietary company that has traded since 2015 and has 14 staff.",
  "Bidding for OSA, SWS and WMS in two Employment Service Areas. Not offering specialist WMS.",
  "Seven assessors on staff: four occupational therapists and one physiotherapist, all registered with AHPRA, and two rehabilitation counsellors. Two more occupational therapists work as contractors in busy periods.",
  "About 420 workplace assessments a year for insurers, employers and return-to-work schemes: ergonomic assessments, functional capacity assessments and workplace modification recommendations.",
  "Has not delivered OSA or SWS assessments, and has not held a contract with the department.",
  "Every report is read by a second clinician before release. Median time from referral to report: 6 business days.",
  "Provides no disability employment services and has no related organisations.",
  "A clinical director heads the practice. An intake coordinator handles referrals. A practice manager keeps a monthly register of registrations, checks and training, and a conflicts register.",
  "No Right Fit For Risk accreditation.",
];

export const DRAFTS = [
  {
    name: "Criterion 1: Organisational capability",
    paragraphs: [
      "Example Workplace Assessments offers Ongoing Support Assessments, Supported Wage System assessments and Workplace Modifications Services assessments in [CHECK: the two Employment Service Areas, named as they appear in the coverage template].",
      "We are a clinical practice of 14 people whose main work since 2015 has been assessing people at their workplaces. We complete about 420 workplace assessments a year [CHECK: figure for each of the last three years] for insurers, employers and return-to-work schemes. Most are functional capacity assessments and recommendations for workplace modifications, which is close to what a WMS assessment asks for. We have not delivered OSA or SWS assessments before. The skills they call on, observing a person doing their job, measuring what they can do, and agreeing a fair result with the worker and the employer, are the ones our assessors use every week, and each assessor will complete the department's OSA and SWS training before taking a work order.",
      "Every allocated work order will go to our intake coordinator, who accepts it or rejects it with reasons on the day it arrives [CHECK: the Deed's time allowed for accepting]. An assessor visits the workplace in person, and a second clinician reads the report before it is submitted. Our median time from referral to report is 6 business days [CHECK: against the Deed's timeframes, which were not in the draft tender].",
      "Seven assessors are on staff: four occupational therapists and one physiotherapist registered with AHPRA, and two rehabilitation counsellors [CHECK: membership of one of the associations the tender names]. Two contract occupational therapists cover leave and peaks. Our practice manager tracks registrations, checks and training monthly, and no work is allocated to an assessor whose record is not current.",
      "We already work with [CHECK: kinds and number of employers, health professionals and employment service providers in each area]. The clinical director signs off the quality system and is the department's contact for performance discussions, and the practice manager handles complaints and the conflicts register.",
    ],
  },
  {
    name: "Criterion 2: Quality",
    paragraphs: [
      "Quality at Example Workplace Assessments rests on one rule: no report leaves the practice until a second clinician has read it against the referral. That rule will apply to every assessment under the Deed, including those done by our two contract assessors, who work to the same templates and procedures and are reviewed in the same way.",
      "After release, the clinical director samples reports each month [CHECK: sample size and last year's results] and discusses what the sample shows with the team. If the department returns a report for correction, the assessor and reviewer will fix it within the time the proposed indicators allow: 5 business days for OSA and SWS, and 2 business days for WMS. We will record each returned report and its cause, and report the pattern to the department at performance discussions.",
      "All of our assessors hold the qualifications the tender requires and have at least two years of practical experience in workplace assessment [CHECK: each assessor against section 2.3.2, including the diploma rule for OSA and SWS]. Our assessors regularly work with people who have high support needs [CHECK: examples and any specific training], and they plan each visit with the worker, and a support person where the worker wants one, so that the assessment reflects an ordinary working day.",
      "Our assessments will be independent. We do not provide disability employment services, including under the new specialist disability employment program, and we have no related organisations. We will not assess anyone employed by our own practice. Before accepting a work order the intake coordinator checks the worker and employer against our conflicts register, and where there is a connection we will reject the allocation and tell the department why.",
    ],
  },
  {
    name: "Criterion 3: Specialist WMS",
    paragraphs: ["Not applicable. Example Workplace Assessments is not tendering for specialist WMS."],
  },
];

// ---------- part 4: what the bidder still has to settle ----------

export const GAPS = [
  "The largest weakness is on the page already: this bidder has never delivered OSA or SWS assessments. The draft answer says so and argues from comparable work. Whether that is strong enough is the bidder's call to make before spending more time.",
  "Every flagged passage in the drafts needs a real figure or name from the bidder's own records, or has to come out.",
  "Read the word limits from the tender form, then cut or extend each answer.",
  "Read the Draft Deed for the assessment timeframes and the insurance required. Neither was in the document this sample was made from.",
  "Cost the Right Fit For Risk work, and confirm where client records and their backups are held, before deciding to bid.",
  "Request the Statement of Tax Record now. Ask two referees who are not connected with the department.",
  "Still to be written: the modern slavery statement, the draft environmental sustainability statement, and the Right Fit For Risk Questionnaire.",
  "Compare everything here with the final tender documents and any addenda. A final tender can differ from its exposure draft.",
];

// ---------- the page ----------

const list = (items, render = escape) => `<ul>\n${items.map((x) => `<li>${render(x)}</li>`).join("\n")}\n</ul>`;

const PATH = "sample-pack/index.html";

// `a(to, text)` makes a link inside the site, as in build.mjs.
function body(a) {
  const src = `<a href="${escape(SOURCE.url)}" rel="noopener">${escape(SOURCE.attribution)}</a>`;
  const lic = `<a href="${escape(SOURCE.licenceUrl)}" rel="noopener license">${escape(SOURCE.licenceShort)}</a>`;
  return `<h1>Sample Bid Draft Pack</h1>
<p class="lead">A Bid Draft Pack is a head start on a tender response: a compliance checklist, a response outline and first-draft answers, made from the tender's own documents and the bidder's own material. This page is one worked through, so you can see what a pack contains.</p>
<div class="box">
<p><b>This is a sample, not a real bid.</b> It was made from one public document, the ${src}, which the ${escape(SOURCE.publisher)} published in ${escape(SOURCE.released)}. That document was a draft for comment only, its timetable has long passed, and nobody can respond to it now. The bidder, ${escape(BIDDER)}, is invented, and so is everything said about it.</p>
<p><b>Nothing here is a promise.</b> A pack is a first draft. The bidder checks every statement and every requirement against the tender documents, changes what needs changing, decides whether to bid, and lodges its own response. No pack can promise that a bid will succeed, be shortlisted or be found compliant.</p>
<p><b>How it was made.</b> This sample was prepared with AI software from the text of that document. Drafts made this way can contain errors or miss a requirement. The department has not seen this page and does not endorse it. Packs are not on sale.</p>
</div>

<h2>The tender at a glance</h2>
<div class="scroll"><table>
<tbody>
${GLANCE.map(([k, v]) => `<tr><th scope="row">${escape(k)}</th><td>${escape(v)}</td></tr>`).join("\n")}
</tbody></table></div>

<h2>Part 1: Compliance checklist</h2>
<p>What the draft says a tender must contain and a bidder must be, with where it says so. The second column restates the draft. The third adds what the draft says elsewhere, and practical suggestions that are not in the draft. The last column is the invented bidder's position, to show how a pack tracks what is done and what is not.</p>
${CHECKLIST.map(
  (g) => `<h3>${escape(g.heading)}</h3>
<p class="note">${escape(g.note)}</p>
<div class="scroll"><table class="wide check">
<thead><tr><th>Section</th><th>Requirement</th><th>What to provide or do</th><th>This bidder</th></tr></thead>
<tbody>
${g.rows
  .map(
    ([ref, need, how, status, note]) =>
      `<tr><td class="nw">${escape(ref)}</td><td class="w">${escape(need)}</td><td class="w">${escape(how)}</td><td><span class="tag ${status}">${STATUSES[status]}</span>${note ? ` <small>${escape(note)}</small>` : ""}</td></tr>`,
  )
  .join("\n")}
</tbody></table></div>`,
).join("\n")}

<h2>Part 2: Response outline</h2>
<p>What each selection criterion asks, a structure for answering it, and the evidence to collect first.</p>
${list(OUTLINE_RULES)}
${OUTLINE.map(
  (c) => `<h3>${escape(c.name)} <small>${escape(c.ref)}</small></h3>
<p><b>What the draft asks for</b></p>
${list(c.asks)}
<p><b>Suggested structure</b></p>
${list(c.plan)}${c.evidence.length ? `\n<p><b>Evidence to gather:</b> ${escape(c.evidence.join("; "))}.</p>` : ""}`,
).join("\n")}

<h2>Part 3: First-draft answers</h2>
<p>In a pack, the answers are written from what the bidder supplies. Here the bidder is invented, so these are the made-up facts the drafts were written from:</p>
${list(BIDDER_FACTS)}
<p>Passages marked <mark class="chk">Check</mark> are where the draft needs a fact the bidder has not given, or a figure that must be confirmed before it is used.</p>
${DRAFTS.map(
  (d) => `<h3>${escape(d.name)}</h3>
<div class="draft">
${d.paragraphs.map((p) => `<p>${flagged(p)}</p>`).join("\n")}
</div>`,
).join("\n")}

<h2>Part 4: What this bidder still has to settle</h2>
${list(GAPS)}

<h2>About this sample</h2>
<p>Source: ${src}, ${escape(SOURCE.publisher)}, ${escape(SOURCE.released)}, used under the <a href="${escape(SOURCE.licenceUrl)}" rel="noopener license">${escape(SOURCE.licence)}</a> licence (${lic}). That licence does not cover the Commonwealth Coat of Arms, the department's logo or trade marks, and none of those is used here. The requirements on this page are summarised and restated from that document in other words, and the checklist, outline and draft answers are additions. Section numbers are given as a guide: some headings in the draft carry no number, and those are cited by section and heading. For the exact wording, read the source.</p>
<p>What the sample does not cover: it was made from sections 1 to 8.14.14 of the draft. The last pages, which are the end of section 8.14 and Appendices A to F and include the draft's own lodgement checklist, are not summarised here. The Draft Deed, the tender form and the coverage template were not part of the document. The final tender, released after the draft, has not been compared with it.</p>
<p>${a("", "Back to the contract data")}</p>`;
}

// What build.mjs needs to make the page. `siteName` goes in the title.
export const samplePack = (siteName) => ({
  path: PATH,
  title: `Sample Bid Draft Pack: a federal tender worked through | ${siteName}`,
  description:
    "A worked sample of a Bid Draft Pack for an Australian Government tender: compliance checklist, response outline and first-draft answers, made from a public exposure draft. The bidder is invented.",
  body,
});
export const SAMPLE_PACK_LINK = PATH.replace(/index\.html$/, "");
