# Job description scoring rubric (draft v0.2)

**Purpose:** Score each posting **1–100** so you can triage applications, compare opportunities, and stay aligned with your stated goals.

**How to use:** Score each dimension independently, then **sum**. Optionally note a **confidence** (high/medium/low) when the posting is vague. Re-score after a recruiter screen if new facts appear.

**Calibration:** Treat **70+** as strong apply priority, **55–69** as worth applying with tailored materials, **40–54** as backup tier, **<40** as usually skip unless strategic (network, practice, dream company).

Apply this rubric when evaluating job postings against the candidate’s resume and any extra preferences they added alongside this text.

---

## Dimension 1: Core technical fit — **25 points**

How well does the **primary day-to-day stack** overlap what you already ship in production?

| Points | Anchor |
|--------|--------|
| 23–25 | Heavy **TypeScript/JavaScript** web work; **React** and/or **Svelte/SvelteKit** or explicit “modern frontend + Node” fit; APIs and real deployed apps. |
| 18–22 | **Full-stack web** with most of: JS/TS, component framework, Node or similar backend, SQL or document DB, REST. |
| 12–17 | **Web-adjacent** (.NET/Java) but clear browser/UI + services; you can credibly pivot with Cerner + Spotlite narrative. |
| 6–11 | Mostly **non-web** (embedded, data science, niche ML) or legacy-only stack with no modern JS path. |
| 0–5 | Stack is a poor match (e.g., required expert in something you don’t claim). |

**Bonus stack signal (additive inside this dimension, capped at 25 total):**

- **+1 each** when the JD explicitly includes one or more of: **SvelteKit, Convex, WorkOS, Netlify, Railway, Tailwind**.
- Use this to break ties between otherwise similar React/Node postings.
- **.NET guidance:** Treat **.NET-heavy roles** as a solid but secondary fit unless the posting also includes meaningful modern web frontend/backend work.

**Your evidence base:** Spotlite (SvelteKit, Tailwind, Convex, WorkOS), Cerner (Node, C#/WPF, MongoDB, REST, Socket.IO), Keeper (React), npm libraries, side projects.

---

## Dimension 2: Role level & title realism — **20 points**

Does the **seniority** match “junior/mid, get back in the field” without setting you up to fail?

| Points | Anchor |
|--------|--------|
| 18–20 | **Junior / Associate / Mid** software engineer, full-stack, frontend, or web developer; years required ≤ ~4–5 or “commensurate experience”; portfolio and agency work plausibly count. |
| 14–17 | “Software engineer” with broad reqs; **“2+ years”** style listings; internship-friendly language OK if JD is skill-based. |
| 8–13 | **Ambiguous** (“engineer” but heavy lead/architect tone) or **internship-only** vs full-time mismatch. |
| 4–7 | **Senior / Staff / Principal** as primary bar, or **10+ years** hard floor without alternate track. |
| 0–3 | Executive, CTO track, or expert specialist bar far above your resume narrative. |

---

## Dimension 3: Work style & scope — **15 points**

Does the **work resemble** what energizes you in your letters and resume (ownership, internal tools, product polish)?

| Points | Anchor |
|--------|--------|
| 13–15 | **In-house product** or internal platform roles with end-to-end ownership, modernization, and clear quality standards. |
| 9–12 | Mixed **product + supportability**; agency/consultancy-style variety (parallel to Spotlite); platform services. |
| 5–8 | **Narrow ticket factory** only, or role is mostly **ops/NOC** without a dev path (unless you explicitly want that track). |
| 0–4 | Role is **pure sales engineering**, unrelated to building software you’d showcase. |

**Note:** Your Savion letter emphasizes **internal tools + efficiency + environmental impact**—boost scores when the JD echoes that; your Carrot/Honeywell threads show general **software engineer** interest.

---

## Dimension 4: Compensation & transparency — **10 points**

Alignment with **$60k–$80k** (flexible) and signal quality.

| Points | Anchor |
|--------|--------|
| 9–10 | **Published range** overlapping $60–80k or clearly junior-to-mid band in KC/national remote; contract rate implies similar annualized. |
| 6–8 | No range but **level/title** and **company type** suggest junior/mid pays in band; or “competitive” + known market. |
| 3–5 | Range **below** comfort or **far above** without clarity (might be senior-only). |
| 0–2 | Unpaid/long unpaid trial, **pure commission**, or equity-only with no salary path. |

---

## Dimension 5: Location & logistics — **10 points**

Match to **Kansas City metro OR fully remote** (US), and **start reality** (2-week notice).

| Points | Anchor |
|--------|--------|
| 9–10 | **Remote (US)** or **KC hybrid/on-site** with reasonable commute; work arrangement explicit. |
| 6–8 | Remote with **state restrictions** you can meet; hybrid in region you’d relocate for (only if you’d consider). |
| 3–5 | **On-site only** in wrong geography, or heavy travel beyond preference. |
| 0–2 | Wrong country/time zone mandate or relocation required when you’re not open to it. |

---

## Dimension 6: Industry & mission resonance (optional differentiator) — **5 points**

| Points | Anchor |
|--------|--------|
| 5 | **Healthcare/education/gov/mission** (Cerner, PowerSchool, Savion-style impact), climate/sustainability, or **trust-heavy B2B**. |
| 3 | Neutral B2B SaaS or prosumer SaaS with sane ethics. |
| 0 | Sectors you’d actively avoid (personal dealbreakers—fill in over time). |

---

## Dimension 7: Hiring process & posting quality (risk / red flags) — **15 points**

Start at **15** and **deduct** for red flags from `job-search-plan.md` and common noise. Floor at **0**.

| Deduction | Example |
|-----------|---------|
| −2 to −3 | Vague **“rockstar/ninja”** culture; **unpaid** take-home > ~4 hours; **no** range + opaque level. |
| −4 to −6 | **“Wear all hats”** with no team size; **extreme on-call** without compensation; **>5** interview rounds hinted. |
| −7 to −9 | **Toxic Glassdoor** pattern (management, churn); **MLM** vibe; equity-only early stage with no salary. |
| −10+ | Suspected scam, legal/ethical concerns, or requirements that contradict visa/residency reality. |

If the posting is **honest and concise**, keep **13–15** here.

---

## Quick worksheet (optional scratch per posting)

Use this only as a thinking aid—not as a required output format for any system.

```
Company:
Title:

1. Technical fit (/25): ___
2. Level realism (/20): ___
3. Work style & scope (/15): ___
4. Comp & transparency (/10): ___
5. Location & logistics (/10): ___
6. Mission resonance (/5): ___
7. Process & red flags (/15): ___  (start 15, subtract)

TOTAL (/100): ___
```

---

## Open questions for refinement (next)

Answer these to tighten weights and anchors:

1. **.NET/C# weighting** — Keep as a secondary fit (current approach), or add explicit +1 when role is modern .NET web with frontend exposure?
2. **Mission weighting** — Keep mission at **5** points, or move some/all points into comp/process dimensions?
3. **Calibration bands** — Keep `70+ apply now`, `55–69 apply if strategic`, or tighten thresholds after scoring 20 real JDs?
