---
slug: equipo-4-subagentes-ventas
category: agentes
title: Build a sales team of 4 subagents in Claude Code
summary: Researcher, qualifier, writer and follow-up: 4 subagents with copy-ready setups and a daily routine.
publishedAt: 2026-11-26
promisedBy: []
template: "Lead qualifier (builder template `lead`): an intake form with scoring; the orchestrator reads the qualified responses through the dForms connector"
thumbnailMotif: "A terminal launches 4 cards (Researcher, Qualifier, Writer, Follow-up) that work in parallel and pull together a daily list with drafts ready to go."
thumbnailVideo: /playbooks/en/equipo-4-subagentes-ventas.webm
thumbnailPoster: /playbooks/en/equipo-4-subagentes-ventas-poster.webp
---
A good SDR does four different jobs every day: researches the account, decides whether it's worth it, writes a first message that doesn't sound like a template and keeps track of who they contacted and when the next touch is due. When one person (or one AI chat) does all four, they blur together: the research comes up short, the message comes out generic and the follow-up gets forgotten.

Claude Code lets you split those four jobs into **subagents**: specialized assistants, each with its own instructions, its own allowed tools and its own working memory. An orchestrator (your main session) hands out the work and pulls the results together. You review and approve.

<!-- anim: equipo-4-subagentes-ventas/orquestador-y-4-subagentes | One chat that researches, qualifies, writes and follows up gets overloaded; split it into 4 subagents with their own context, and the orchestrator hands out the work while you approve -->

This guide gives you the 4 roles, a copy-ready setup for each one and a 20-minute daily routine. You don't need to know how to code, but you do need to be comfortable opening a terminal.

## What a subagent is, in plain terms

A subagent is a text file with instructions that Claude Code loads as a specialist. It lives in your project's `.claude/agents/` folder (or in `~/.claude/agents/` if you want it in all your projects) and has two parts: a header with its name, when to use it and which tools it can touch, and its instructions below that.

Three things make it useful for sales:

1. **Its own context.** Each subagent works in its own context window. Researching 30 accounts doesn't flood the main chat, and each one focuses on a single task.
2. **Limited tools.** The researcher can search the web, but it can't write to your CRM. The writer can write drafts, but it can't browse. Fewer permissions, fewer surprises.
3. **They run on their own or on request.** Claude Code uses the subagent's description to know when to hand work off to it. You can also ask for it directly: "use the researcher on this list."

You can create them with the `/agents` command inside Claude Code, or by writing the file yourself.

<!-- muro -->

## The 4 roles

| Subagent | Its only job | Tools | Delivers |
|---|---|---|---|
| Researcher | Gather verifiable facts on each account | Web search and reading | One profile per account, with sources |
| Qualifier | Score each account against your ideal customer | Read-only file access | Score, verdict and why |
| Writer | Write the first message and 2 follow-ups | File read and write | Drafts, never sends |
| Follow-up | Keep the log and say who's due today | Log read and write | Today's list |

The rule that holds it all together: **no subagent sends anything.** They all leave drafts in a folder. You're the one who sends.

## The orchestrator

The orchestrator is your regular Claude Code session. Give it the team rules in the `CLAUDE.md` file in your project folder:

```
# Sales team

Ideal customer: [industry, size, title of the decision maker, buying signals].
Disqualifiers: [the 3 to 5 things that mean someone will never buy from you].

Flow for each new list in leads/inbox.csv:
1. researcher: one profile per account in leads/profiles/.
2. qualifier: score and verdict in leads/qualified.csv.
3. writer: only for a Book or Nurture verdict, drafts in leads/drafts/.
4. follow-up: updates leads/log.csv and gives me today's list.

Rules:
- Nobody sends messages. Everything stays as a draft for me to review.
- If a fact has no source, mark it "Unverified".
- Run the researcher in parallel, in batches of 5 accounts.
```

<!-- anim: equipo-4-subagentes-ventas/flujo-de-archivos | A list of accounts goes through the 4 subagents and leaves a file at each step, from the inbox to today's list, and no message ever sends itself -->

## Copy-ready setup for all 4

Create each file in `.claude/agents/`.

**`researcher.md`**

```
---
name: researcher
description: Researches accounts and prospects before reaching out. Use it on every new list of leads.
tools: WebSearch, WebFetch, Write
---
You are a B2B sales researcher. For each account, check its website, news and the company's public profiles:
- What it sells and to whom, in one sentence.
- Approximate size and where it operates.
- 2 or 3 recent facts you can use to open a conversation (a new hire, a launch, a post).
- Signs that it has the problem we solve.
Every fact gets its URL. If you can't find something, write "Unverified". Never make anything up.
Save one profile per account in leads/profiles/<company>.md.
```

**`qualifier.md`**

```
---
name: qualifier
description: Qualifies researched accounts against the ideal customer. Use it after the researcher.
tools: Read, Write
---
Read the ideal customer and the disqualifiers in CLAUDE.md and every profile in leads/profiles/.
Score from 0 to 10: fit (0 to 4), signs of the problem (0 to 3), timing (0 to 3).
A disqualifier sets the score to 0.
Verdict: Book (7 or more), Nurture (4 to 6), Discard (0 to 3).
Write one row per account in leads/qualified.csv: company, score, verdict and one line on why.
Don't use anything that isn't in the profile.
```

<!-- anim: equipo-4-subagentes-ventas/puntaje-del-calificador | The qualifier adds up fit, signs of the problem and timing to a max of 10 points and gives the verdict; a disqualifier sets the score to 0 -->

**`writer.md`**

```
---
name: writer
description: Writes first-touch and follow-up drafts for qualified accounts.
tools: Read, Write
---
You only work on accounts with a Book or Nurture verdict in leads/qualified.csv.
For each account, write:
1. A first message of 90 words max. The first sentence is about their company, using a fact from the profile. One problem only. End with a yes or no question.
2. A follow-up at 3 days, 60 words max, with something new and valuable.
3. A breakup at 10 days: ask if you should close the file, with humor and no guilt trip.
Banned: "hope you're doing well", "just following up", facts without a source.
Save everything in leads/drafts/<company>.md. You never send anything.
```

**`follow-up.md`**

```
---
name: follow-up
description: Keeps the contact log and builds the daily list. Use it at the start of each workday.
tools: Read, Write
---
You maintain leads/log.csv with: company, verdict, last touch, date, next touch, status.
Every morning:
- Add the new accounts from leads/qualified.csv.
- List who's due today, in score order.
- Mark as "cold" anyone with 3 touches and no reply.
- Never delete rows, only change the status.
```

## Your daily routine

1. **Morning, 5 minutes.** Paste the new list into `leads/inbox.csv` and type: "Run the flow on the new list."
2. **10 minutes.** Review `leads/qualified.csv`. If a verdict doesn't sit right with you, fix it by hand: it's the best signal for sharpening the ideal customer in `CLAUDE.md`.
3. **5 minutes.** Open the Book drafts, edit anything that sounds off and send them yourself from your email or LinkedIn.
4. **End of day.** Tell the orchestrator what you sent and who replied: "Update the log: I sent to these 6, 2 replied." The follow-up subagent logs it.

<!-- img: equipo-4-subagentes-ventas/rutina-diaria | The 20-minute daily routine on a timeline: 5 minutes to load the list, 10 to review verdicts, 5 to edit and send yourself, and the log at the end of the day -->

## Costs, traps and when not to do this

- **Every subagent uses tokens.** Running 4 specialists per account costs more than a single chat. Start with small batches and watch your usage before you move to 50 accounts a day.
- **Research can make things up.** That's why there's the one-URL-per-fact rule and the "Unverified" tag. Check the sources on your Book accounts before you write to them.
- **Don't automate sending.** One wrong message to a good prospect costs more than the time you save. The team preps; you decide.
- **Follow each platform's rules.** Don't use the researcher to scrape data from sites that prohibit it.
- **When it's not worth it:** if you get fewer than 10 leads a week or you're still not clear on your ideal customer. Write down your ideal customer first; the team only multiplies what you already know.

## Do it with dForms

The best list for your team isn't a purchased database: it's the people who filled out your form, with their answers and their score. Connect the two.

<!-- img: equipo-4-subagentes-ventas/form-al-equipo | Diagram: responses from the "Demo request" form go through the dForms connector to Claude Code and into the researcher's list -->

**The form: "Demo request"** (Lead qualifier template).

1. **Forms → Create form**, **Slides** layout, **Lead qualifier** template. Add company and website, and keep 3 or 4 scored questions (size, urgency, role).
2. **Logic → Scoring** and **Logic → Outcomes:** create the same three verdicts your qualifier uses (Book, Nurture, Discard), with their ending messages. That way the form and the subagent speak the same language.
3. **Publish** and put the link on your website and in your email signature.
4. Connect dForms to Claude Code: in app.dforms.ai open **Connect your agent** and copy the connector URL. In your terminal, run `claude mcp add --transport http dforms <connector URL>` and then `/mcp` inside Claude Code to sign in.
5. Add this step zero to your `CLAUDE.md`: "Before reading leads/inbox.csv, use dForms to pull yesterday's responses from the Demo request form with a Book or Nurture outcome and add them to the list, with their website and their answers."

From that day on, the researcher starts with accounts that already raised their hand, and the writer opens each message with what the person answered.
