---
slug: prompts-prohibidos-vender-con-ia
category: ventas
title: The forbidden prompts for selling with AI
summary: 12 prompts in 3 levels for the 4 moments that decide a sale: first contact, follow-up, no-show and price.
publishedAt: 2026-11-26
promisedBy: []
template: "Lead qualifier (builder template `lead`), adapted: \"Filter before booking\" with budget, decision maker and urgency; booking only if they qualify"
thumbnailMotif: "A chat gets a pasted prompt, the reply writes itself and a tag climbs from $2K to $6K to $10K as a padlock opens."
thumbnailVideo: /playbooks/en/prompts-prohibidos-vender-con-ia.webm
thumbnailPoster: /playbooks/en/prompts-prohibidos-vender-con-ia-poster.webp
---
We call them forbidden because they feel like cheating: every prompt in this guide does in two minutes what takes a salesperson a whole afternoon. They're organized by the four moments that decide a sale: first contact, follow-up, the no-show and the price objection.

<!-- img: prompts-prohibidos-vender-con-ia/cuatro-momentos | Timeline of a sale with its four moments: first contact, follow-up, no-show and price, with the prompts for each level underneath -->

And they come in 3 levels, matching three different kinds of sellers:

| Level | What they do with AI | Prompts |
|---|---|---|
| $2K | Copy and paste into ChatGPT or Claude, one message at a time | 02, 04, 06, 08 |
| $6K | Use AI to build systems: proposals, sequences, practice | 03, 05, 07, 09 |
| $10K | Build a filter that works while they sell | 12 and the final step |

Start at your level and work up. They work in ChatGPT, Claude or Gemini, and you swap whatever is in [brackets] for your own details. The trick almost nobody uses: paste your sales brief first.

## Step zero: your sales brief

The number one reason AI writes generic copy is that it knows nothing about your business. Fill in this brief once, save it in your notes and paste it at the start of every chat.

<!-- anim: prompts-prohibidos-vender-con-ia/con-ficha-y-sin-ficha | The same request in a chat without the brief returns a generic message; after pasting the sales brief first, the AI writes a message about the prospect's company -->

**Prompt 01 · Sales brief.** Use it at the start of every chat.

```
Role: You are my sales assistant. Use this brief in everything you write in this chat.
My business
- What I sell: [in one sentence]
- Ideal client: [industry, size and title of the decision maker]
- Problem I solve: [the pain, in my clients' words]
- Result I deliver: [a real case with a number]
- Price range: [from / to]
- Common objections: [the 3 I hear most]
- If they don't buy from me: [what they do today, even if it's "nothing" or "Excel"]
- Tone: [friendly or formal], plain US English.
Rules
- Short sentences. No marketing buzzwords.
- Never make up data, cases or clients.
- If you're missing information, ask me before you write.
To start: reply only "Ready" and wait for my first instruction.
```

Why it works: the "never make up" and "ask me before" lines are the ones that change the result the most. Without them, the AI fills the gaps with guesses.

<!-- muro -->

## Moment 1: first contact

**$2K · Prompt 02 · The email that actually gets read.** Before you reach out to someone new. You get 2 emails and 3 subject lines.

```
Context: I'm reaching out for the first time to [name], [title] at [company].
What I know about their company: [one real fact: a new hire, a post, a review].
Task: Write an email to get a 15-minute call.
Rules: 90 words max. The first sentence is about their company, not mine.
One problem and one result. End with a yes or no question, no calendar link.
Deliver: 2 versions (one direct, one that sparks curiosity) and 3 subject lines of 5 words max, in lowercase.
```

**$6K · Prompt 03 · Proposal and objections.** Right after the discovery call.

```
Context: My notes from the call with [company]: [paste your notes or the transcript].
Task:
1. Sum up the client's problem in 3 lines, in their words.
2. Build a 1-page proposal: current situation, what we propose, expected result, investment and next step with a date.
3. List the 5 most likely objections. For each one: the line from the call that gives it away and an answer of 2 sentences max.
4. Tell me what I forgot to ask and how to ask it.
Rule: if a number isn't in my notes, write "[to fill in]". Don't make it up.
```

## Moment 2: the follow-up

**$2K · Prompt 04 · Follow-up after the meeting.** The next day.

```
Context: Yesterday I met with [name] from [company]. We talked about [topic] and [what] was left pending.
Task: Write a follow-up message for [text / email].
Rules: 60 words max. Open with something specific they said in the meeting.
Add just one new thing of value: [a fact, a case or a resource].
End with a concrete question with a date.
Banned: "just following up," "hope you're doing well" and "let me know."
```

**$6K · Prompt 05 · 6 touches in 14 days.** When a lead goes cold.

```
Context: A lead who [didn't reply after the proposal / asked for info and disappeared].
Channels I use: [email, text, phone call, LinkedIn].
Task: Design a sequence of 6 touches over 14 days.
Rules: every touch adds something new (a case, a question, a fact or a resource).
Mix channels, never two emails in a row. Texts: 40 words max.
Touch 6 is the breakup: ask if you should close the file, with humor and no guilt.
Deliver: for each touch, day, channel, goal and ready-to-send message. At the end, a table for my CRM.
```

Touch 6, the "should I close the file?" one, tends to get replies: nobody likes closing a door.

## Moment 3: the no-show

**$2K · Prompt 06 · Reschedule without the guilt trip.** Same day.

```
Context: [Name] didn't show up to our meeting today at [time].
Task: Write a text to reschedule.
Rules: 35 words max. Zero complaining, zero guilt: assume their day got away from them.
Offer 2 times: [option 1] and [option 2]. End with "does 1 or 2 work better?"
Deliver: 3 versions: warm, direct and funny.
```

**$6K · Prompt 07 · The anti no-show chain.** Whenever you book a meeting.

```
Context: A [type] meeting, booked [X] days in advance.
Task: Write the reminders:
1. When booked: what will happen and what they should have on hand.
2. 24 hours before: a question that asks for a reply, like "are we still on?"
3. 2 hours before: a short reminder with the link.
4. 5 minutes late: the link again, in one line.
5. If they didn't show: reschedule with 2 new times.
6. 48 hours with no reply: one last message to close the loop.
Deliver: for each message, channel, timing and text. Texts: 40 words max.
```

The 24-hour reminder asks for a reply. Whoever says "yes" commits, and whoever doesn't reply warns you early that the meeting is at risk.

<!-- anim: prompts-prohibidos-vender-con-ia/cadena-anti-no-show | A timeline from booking to the meeting shows the reminders in the anti no-show chain and how the 24-hour one asks for a reply that locks in a commitment -->

## Moment 4: "it's too expensive"

**$2K · Prompt 08 · Read the objection.** When they tell you it's too expensive.

```
Context: A prospect told me: "[the objection, word for word]".
I sell [product] to [type of client] for [price]. I already showed them [what they saw].
Task:
1. What they might really be saying: 3 possible readings.
2. One question to find out which of the 3 it is.
3. One answer per reading, 3 sentences max.
4. What I should not say to them.
Rule: no answer lowers the price.
```

**$6K · Prompt 09 · Roleplay with a tough client.** Before an important call. Use voice mode: practicing out loud feels a lot more like the real call.

```
Your role: You are a [title] at a [type of company] and you think it's expensive. Main objection: [objection].
You have 2 hidden objections you only bring up if I ask the right questions: [objection 2] and [objection 3].
Rules: answer short, sometimes curt. You only give in if I ask good questions and tie the price to your problem.
Evaluation: after 8 exchanges, or if I type "pause," break character. Score me from 1 to 10 on discovery, objection handling and closing. Quote the exact line where I slipped and how a top seller would say it.
To start: you open, stating the objection.
```

## Bonus: before and after the call

**Prompt 10 · Prep me for the call.** 10 minutes before.

```
In [X] minutes I have a call with [name], [title] at [company]. Here's what I know: [their website, their LinkedIn or my notes].
On a single screen: 3 facts about their company I should mention, 5 discovery questions from easiest to deepest, the most likely objection with its answer and a good next step to ask for at the end.
```

**Prompt 11 · Post-mortem on the lost deal.** Every time you lose one.

```
This is the whole conversation with [client], who didn't close: [paste emails, chats or transcript].
Be direct, don't console me. 1. At what exact moment was it lost? Quote the line. 2. What signal did I ignore? 3. Three things I'd do differently, ranked by impact. 4. Is a last attempt worth it? If so, write me the message.
```

Make it a habit: in a month you'll see the same mistake repeating, and that's the one costing you the most money.

## $10K level: let the filter work without you

The $2K and $6K levels make you faster, but they still depend on you. What sets the $10K seller apart is that part of the work happens without them. The best way to handle the price objection is to never sit down with someone who can't pay. To get there, confirm budget, decision maker and urgency before booking.

<!-- anim: prompts-prohibidos-vender-con-ia/filtro-antes-de-agendar | Three leads answer budget, decision maker and urgency; their points add up and only the one who clears the cutoff sees your calendar, while the others get a free resource -->

**$10K · Prompt 12 · Design your filter.** Paste it after your brief.

```
Using my sales brief, design 3 multiple choice questions to confirm before booking: budget, decision maker and urgency.
For each option, give me a score (positive, zero or negative) and tell me the score at which a meeting is worth it.
The questions should sound natural, never like an interrogation.
```

## Do it with dForms

Turn the output of prompt 12 into a form that filters on its own, and put your booking link behind it.

**The form: "Filter before booking"** (built from the Lead qualifier template).

1. In **Forms → Create form**, choose **Slides** and the **Lead qualifier** template. Swap the questions for the 3 from prompt 12 and add name, email and phone at the end.
2. In **Logic → Scoring**, turn on scoring and copy the points the AI gave you.
3. In **Logic → Outcomes**, create two ranges: "Doesn't qualify" (you thank them and leave them a free resource or your smallest plan) and "Qualifies."
4. Add a **Scheduler** with your Calendly and in **Edit logic** set it to "Show when Score so far is Greater than" your cutoff. Anyone below the cutoff never sees your calendar.
5. In **Connect → Integrations**, send every response to HubSpot with its score, or to a webhook to alert your team.
6. Publish it and replace your calendar link with the form link in your email signature, your bio and your emails.

Now prompt 10 works even better: you walk into every call with budget, decision maker and urgency already answered.
