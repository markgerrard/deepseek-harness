---
name: agent-review
description: Use when the manager asks about a sales agent by name — review their last call, their recent calls, coaching suggestions, "what about <name>", or comparing agents. Encodes the resolve → calls → recordings → transcripts → windowed-aggregate query chain and the answer format, so a review takes 3-4 tool calls instead of a schema-discovery loop.
---

# Agent review

The manager's dominant question shape: "review <agent>'s last call", "look at
her last 10 calls and suggest improvements", "what about <other agent>?".
Follow this chain instead of rediscovering the schema.

## 1. Resolve the agent — always to agent_id first

```sql
SELECT DISTINCT agent_id, agent_name
FROM calls
WHERE agent_name ILIKE '%<name>%' OR original_agent_name ILIKE '%<name>%'
```

- Zero rows: the name is probably misheard/misspelled — retry with phonetic
  variants in one query (e.g. Cavin → Calvin/Gavin/Kevin), and check
  contact_name too in case they meant a prospect.
- Multiple agents: show both briefly and ask which — or cover both if the
  answer stays short.
- After resolution, filter every later query by `agent_id`, not name.

## 2. Recent calls — default to CONVERSATIONS, not dials

"Last N calls" means the last N connected conversations unless the manager
explicitly asks for all activity — a raw last-N is mostly voicemails and
instant disconnects and reviews nothing.

```sql
SELECT id, date, direction, status, total_time, talking_time, call_outcome,
       call_summary, contact_name, prospect_company_name
FROM calls
WHERE agent_id = <id>
  AND status = 'answered'
  AND talking_time >= 30
  AND call_outcome IS DISTINCT FROM 'voicemail'
ORDER BY date DESC
LIMIT <n>
```

The talking_time gate, not the outcome, decides — a NULL-outcome 500s
inbound call is a real conversation someone forgot to log; an "answered"
45s outbound with outcome voicemail is a message left, hence the explicit
voicemail exclusion. Always say what you filtered and state the dial
volume next to it ("her last 10 conversations — 47 dials in that span, 29
voicemail/unconnected"), using a companion count over the same date span.
Drop the filter when the question is about activity or volume itself.

Column facts (mis-guessing these wastes turns): the date column is `date`
(not call_date); durations are `total_time`/`talking_time` in seconds;
outcome vocabulary is sale_made, callback_scheduled, no_decision,
not_interested, voicemail, other, and NULL (NULL usually = missed /
unconnected / not logged — but see the gate above).

## 3. The 30-day picture — windowed, denominated

```sql
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE call_outcome = 'sale_made')          AS sales,
       COUNT(*) FILTER (WHERE call_outcome = 'callback_scheduled') AS callbacks,
       COUNT(*) FILTER (WHERE call_outcome = 'no_decision')        AS no_decision,
       COUNT(*) FILTER (WHERE call_outcome = 'not_interested')     AS not_interested,
       COUNT(*) FILTER (WHERE call_outcome = 'voicemail')          AS voicemail,
       COUNT(*) FILTER (WHERE call_outcome IS NULL)                AS null_outcome,
       (AVG(talking_time) FILTER (WHERE talking_time > 0))::int    AS avg_talking_s
FROM calls
WHERE agent_id = <id> AND date >= now() - interval '30 days'
```

For agent-vs-agent comparison, run the same query with
`WHERE agent_id IN (...) GROUP BY agent_id, agent_name`.

## 4. Transcripts — read before coaching, fetch in ONE batch

```sql
SELECT r.call_id, r.id AS recording_id, r.duration
FROM recordings r WHERE r.call_id IN (<recent ids>) ORDER BY r.call_id
```

Pick the substantive recordings (duration over ~120s; short connects and
voicemails rarely carry coaching signal), then fetch ALL of them in one
call — never one query per recording:

```
callhub_transcripts(recording_ids=[<rid1>, <rid2>, ...])
```

Results come back grouped per recording with per-recording `truncated`
flags, and ids absent from the replica listed in `missing`. The same
batching rule applies to any per-call metadata: one `IN (...)` query, not a
query per call. `chunk_index` is the per-recording turn ordinal. Speaker
labels are per-call guesses — read individual calls; never aggregate
across calls by speaker.

## 5. Answer format

What the manager audits, in this order:

1. One-line verdict.
2. Last-N table: call id, date/time, duration, outcome, who/company.
3. The 30-day aggregate with its window stated inline.
4. Technique notes from transcripts — each point cites (call_id,
   chunk_index) and quotes the sentence, strengths before weaknesses.
5. Two or three concrete coaching suggestions tied to the quoted moments,
   not generic sales advice.

Caveat discipline per the persona: apply always, recite once — a clause
next to the number it qualifies, never a caveats section.
