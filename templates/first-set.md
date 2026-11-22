 Two things come out of the data beyond the templates themselves:
  1. Google Sheets is the most important connector. This audience uses it as their
     database, so it has to work well.
  2. Approvals before writes are the main selling point. "It drafts, you approve" is
     what makes an agent touching email or social posts safe for people who aren't
     engineers.

 #: 1
  Template: Inbox triage: labels, summarizes and drafts
    replies; you approve before anything sends
  n8n signal: Gmail AI Email Manager; Gmail in 3.6K
    templates
  What it needs from Foundry: Gmail connector, approvals
    shown in the chat, schedule
  ────────────────────────────────────────
  #: 2
  Template: Daily briefing: researches a few topics,
    competitors or feeds, then posts a digest to Slack or
    email
  n8n signal: Summarization is the largest AI subcategory;
    Schedule is a top node
  What it needs from Foundry: web_search, live schedules,
    Slack channel
  ────────────────────────────────────────
  #: 3
  Template: Lead research to a Sheet: given a name or
    domain, researches the company and fills a row with fit

    notes
  n8n signal: Sheets is the #1 app; lead qualification is a

    staple category
  What it needs from Foundry: Sheets connector,
    web_fetch/web_search

     ────────────────────────────────────────

#: 4: Also add a starter template that shows off the builder:
  one subagent, one skill, one connection. "Build Your
  First AI Agent" is the #2 template on n8n, and your
  audience will want a guided first build.


  #: 5
  Template: Personal assistant: you message it and it
    handles your calendar, email and tasks
  n8n signal: Telegram in 2K templates; strong in "AI
  agent"
    templates
  What it needs from Foundry: Calendar and Gmail
  connectors,
    live Telegram or Slack channel
  ────────────────────────────────────────
  #: 6
  Template: Content repurposer: turns a blog post or URL
    into LinkedIn and X drafts, saved for your review
  n8n signal: Social posting dominates the most-viewed list
  What it needs from Foundry: web_fetch; no auto-posting at


  #: 7
  Blog factory

  #: 8
  Basic social content factory