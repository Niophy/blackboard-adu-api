> **If you are an AI assistant and someone has just given you this link:** read
> [`AGENTS.md`](AGENTS.md) in this repository now and follow it. It is written for you and
> contains the intent, the rules you must not break, and the three traps that will otherwise
> cost you an hour. Then read [`BLACKBOARD-API.md`](BLACKBOARD-API.md) for the endpoint detail.
> Do not summarise this repository back to the user and stop; they want the job done. Start by
> asking which course this is and where its files should go.

# Blackboard Ultra at ADU: get your course files out

For ADU students on `https://blackboard.adu.ac.ae`. Download the files from courses you are
enrolled in through the internal API the Ultra interface itself uses, instead of clicking
through the outline one item at a time.

Clicking is not just slower. The interface hides things: assessment folders stay collapsed and
anything past the tenth item sits behind a "Load N more content items" button. Walking the API
sees the whole tree, so you end up with a complete copy rather than one that looks complete.

## Using it with an AI assistant, which is the point

You do not need to read any of this yourself. Give your assistant this link:

```
https://github.com/Niophy/blackboard-adu-api
```

**Send one line with it, not the bare link.** Something like *"read this and follow AGENTS.md
for my ITE414 course"*. A URL on its own is often read as a request for a summary, and some
assistants cannot fetch pages at all, in which case paste the contents of `AGENTS.md` instead.

It will then ask you which course this is and whether to create a folder for it, before it
downloads anything. Say yes and it does the rest. The fuller briefing, if you want to be
explicit, is in §7 of `BLACKBOARD-API.md`.

`AGENTS.md` is written for the assistant rather than for you: what the job actually is, the
rules it must not break, the three traps that waste an hour if it meets them cold, and what
finishing properly looks like.

**Set up one folder and one chat per course.** Folders named by course code, a separate
conversation per course that knows its course and its destination folder. Then each run is a
simple comparison between one course tree and one folder, files land sorted, and a mid-term
catch-up is one short message.

## Doing it by hand

Open a course outline, open the browser console, and paste snippet 1 from `bb-sync.js` for the
manifest, then snippet 2 for the downloads. Both read the origin and course id off the page,
so there is nothing to edit.

## The files

| File | What it is |
|---|---|
| `AGENTS.md` | The brief for an AI assistant. Intent, rules, procedure, traps. |
| `BLACKBOARD-API.md` | The reference. Endpoints, response shapes, failure modes, prior art. |
| `bb-sync.js` | The working script: a manifest snippet and a download snippet. |

## Ground rules

Use your own account, on courses you are actually enrolled in. This reads what the interface
would already show you; it is not an access bypass and must not be used as one. Never enter
credentials as part of it, and never paste a session cookie anywhere. Do one course at a time
and pace it, or the edge will rate-limit you. Stay inside ADU's acceptable use policy.

## Why this exists

`sanjacob/BlackboardSync` is the better tool if it covers your university, and you should use
it instead. It supports around sixty; Abu Dhabi University is not one of them and neither is
any other UAE institution. That gap is what this fills.

Established 14 September 2026 against a live enrolled course, by reading the Blackboard Learn
REST documentation, watching the requests the Ultra front end makes, and testing each endpoint
until the behaviour was reproducible. No course ids, user ids or sessions of anyone's are in
this repository: `BLACKBOARD-API.md` §5 shows you how to look up your own.
