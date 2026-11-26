---
slug: calificador-claude
category: agentes
title: How Claude qualifies your leads for you
summary: 4 prompts so Claude defines your ideal customer, 7 qualifying questions, the score, and the Book, Nurture and Discard endings.
publishedAt: 2026-11-26
promisedBy: []
template: "Lead qualifier (builder template `lead`): a qualifier with up to 7 questions and 3 outcomes (Book with a Scheduler, Nurture, Discard), built from the output of the 4 prompts"
thumbnailMotif: "Claude writes 4 prompts one after another; leads enter the form and come out sorted into three lanes: Book, Nurture and Discard."
thumbnailVideo: /playbooks/en/calificador-claude.webm
thumbnailPoster: /playbooks/en/calificador-claude-poster.webp
---
Claude can now do the job only your best salesperson used to do: look at a prospect and know, in seconds, whether they're worth it. Who your ideal customer is, which questions give them away, how much each answer is worth. It can design all of that for you, today.

And almost everyone is going to use it wrong. Most people use AI to write more posts and more emails: more volume of the same thing. Meanwhile, their leads keep coming in through a generic form (name, email, "tell us more") and their team keeps booking meetings with tire kickers who were never going to buy.

The real waste isn't in attracting leads, it's in filtering them. Every lead that doesn't qualify still takes up a call, a slot on the calendar and your team's energy. The best use of Claude in sales isn't writing more content: it's designing the filter. The exact questions, the score for each answer and the line that separates the lead who buys from the one who just wanted the PDF.

## Why a form designed by AI changes the game

A generic form asks the same questions to the executive with a budget and the student doing homework. Both land in your CRM with the same weight, and your team loses hours finding out on a call what 4 well-built questions would have told you for free.

<!-- anim: calificador-claude/mismo-peso-vs-puntaje | An executive with a budget and a student fill out a generic form and land in your CRM looking the same; with 4 well-built questions, one goes to your calendar and the other to content -->

The right questions do the SDR's job. A lead who answers "I have an approved budget and I need this this quarter" doesn't need a discovery call: they need a booking link. One who answers "I'm just exploring" doesn't need a call either: they need content, and they shouldn't take up anyone's time. The difference between the two is 3 or 4 questions. The right ones.

The problem was never asking questions, it was knowing which ones. That's where Claude comes in: it reads your business and works out your ideal customer, writes the questions that separate buyers from browsers, scores each answer and sets the threshold for booking.

<!-- muro -->

## What the system does, end to end

1. **The lead enters the form,** from your LinkedIn, your website, a QR code or anywhere else.
2. **They answer the questions Claude designed.** Few, direct, and each one reveals something: budget, urgency, size or authority.
3. **Each answer adds or subtracts points.** The score runs as they go; they never see it.
4. **The form decides on its own:** high score, it shows your calendar and they book right there; medium, it sends them to your nurture sequence; low, it thanks them gracefully and doesn't take up anyone's time.
5. **Everything lands in your CRM with its score.** On Monday the list is already sorted: who's a meeting, who's an email and who's nothing.

<!-- anim: calificador-claude/tres-carriles | A lead answers the questions, their score runs without them seeing it and the form sends them on its own to one of three lanes, book, nurture or discard, before they land in your CRM -->

This replaces the SDR reviewing leads one by one, the calls with people who were never going to buy and the 3-day "let me check if they qualify" that lets your good lead go cold.

## The 4 prompts

Open Claude, paste the prompt, replace what's in brackets and run it. Run them in order and in the same chat, so Claude keeps the context. For the first one, turn on web search so it reads your actual site.

<!-- anim: calificador-claude/cadena-de-4-prompts | Four prompts run in order in the same Claude chat and each one uses what the previous one left: ideal customer, questions, score and endings -->

**Prompt 1 · Define who to qualify.**

```
You are a B2B go-to-market strategist. Build the ideal customer profile (ICP) for the business behind the website I give you at the end, with one goal: qualifying leads that come in through a form.

Rules:
- Use web search. Actually open the site: home, product, pricing, case studies. Don't make things up.
- Specific beats long. Never write "B2B companies" if you can write "marketing agencies with 5 to 30 people that sell retainers".
- If something isn't clear, search for the company by name and fill in the gaps.

Return exactly this:
## 1. What this business sells: the offer in one sentence with no marketing speak, the outcome the customer is buying, price range if you can infer it.
## 2. The ideal customer: specific industry, size, the exact buyer (title and department), their 3 deepest pains and the trigger (why they buy now and not in 6 months).
## 3. The signals: the 6 to 10 that, asked in a form, reveal whether a lead is a real buyer. For each one, what it reveals and why it predicts a purchase. Strongest to weakest.
## 4. The disqualifiers: the 3 to 5 answers that show a lead is not going to buy.

No intro and no wrap-up. Here's the site: [your website URL]
```

**Prompt 2 · Write the questions that qualify.**

```
You are a B2B qualification form designer. Using the ICP above, design the exact questions for a form that separates buyers from browsers.

Rules:
- 7 questions max. If a question doesn't change the score, cut it.
- All multiple choice or scale. Open text can't be scored.
- Make them sound natural: "When would you like to solve this?", not "Indicate your purchase time horizon".
- Cover budget, urgency, authority and fit. If the ICP points to another dimension that predicts better, use it and tell me why.
- Lowest friction to highest: the budget question never goes first.

For each question: the text ready to copy, the options ready to copy and what each option measures. At the end, the full order with one line on why. No intro and no wrap-up.
```

**Prompt 3 · Assign the score and the thresholds.**

```
You are a senior RevOps lead. Turn the questions above into a scoring system for a form that decides on its own.

Rules:
- Points for every option of every question: positive, zero or negative.
- Strong signals weigh more than weak ones.
- A hard disqualifier must sink the total on its own.
- Calculate the lowest and highest possible score.

Return: the points table (question, option, points, one line on why), the total range and 3 thresholds:
- Book (X and up): goes straight to the calendar
- Nurture (between X and Y): gets content, not a call
- Discard (below Y): thank them and end
Finish with a stress test: simulate 3 leads (one who buys, one who's lukewarm, one who's just curious), show their score and check that each one lands where it should. If any of them lands wrong, fix the table and show the final version.
```

**Prompt 4 · Write the endings.** Each threshold needs its own ending screen, and it's the part almost everyone gets wrong.

```
You are a conversion copywriter. Write the 3 ending screens for the form above, one per threshold.

Rules:
- Book: celebrate without overdoing it and take them to the calendar right away. A hot lead goes cold in hours.
- Nurture: honest and generous. They get something valuable today, with no fake promise of a call.
- Discard: gracious. It must never feel like rejection. Thank them, leave them a resource and close well. This copy protects your brand.
- 40 words max per screen. Human and direct, no "Congratulations!".

Return only: Book screen, Nurture screen, Discard screen.
```

## Before you publish it

- **Review the disqualifiers yourself.** Claude infers; you know who will never buy from you.
- **Test all 3 paths** with the 3 simulated leads from prompt 3 before you send traffic.
- **Adjust with real data.** After the first 50 responses, compare score against who closed and move the cutoffs.

## Do it with dForms

You now have the questions, the score, the thresholds and the copy. All that's left is to put them into a form that knows how to score, branch and book, so you don't run this by hand lead by lead.

<!-- img: calificador-claude/resultados-en-dforms | The Logic, Outcomes screen in dForms with the three ranges book, nurture and discard, their score limits and the ending screen for each one -->

**The form: "Qualifier"** (Lead qualifier template).

1. **Forms → Create form**, **Slides** layout, **Lead qualifier** template. Replace its questions with the ones from prompt 2, in the same order, and add name and email at the end.
2. **Logic → Scoring:** turn on **Enable scoring** and copy the table from prompt 3, option by option. Check that the highest possible score matches the one Claude calculated.
3. **Logic → Outcomes:** create three ranges labeled Book, Nurture and Discard with the limits from prompt 3. Paste the matching screen from prompt 4 into each one.
4. Add a **Scheduler** after the last scored question, connect Calendly and in **Edit logic** set it to "Show when Score so far is Greater than" the start of Book minus one.
5. In **Connect → Integrations**, send each lead to HubSpot with its score and outcome, or to a webhook that adds it to your nurture sequence if it lands in Nurture.
6. **Publish**, test the 3 simulated leads and put the link wherever your "Contact us" lives today.

**Shortcut with the connector:** if you connect dForms to Claude (in app.dforms.ai, **Connect your agent**), when prompt 4 is done type this in the same chat: "Use dForms to create this form with the questions, the points, the 3 outcomes and their screens, and give me the link." Claude builds it and publishes it without you copying a thing.
