# Newcomer exercise

This is a proposed usability check, not a completed study. Engineering tests
exercise installation and execution but do not measure whether humans understand
the documentation.

## Participants and preparation

Ask two people who did not implement Core to try it: one TypeScript developer
and one person who mainly uses Python. Give them only the README, Quickstart,
the example and a tested package build. Prepare a working model credential and
record the Node/Python versions and package commit. Confirm model access first
so credential provisioning does not consume the task budget.

## Tasks and suggested targets

| Task | Target | Record |
| --- | --- | --- |
| Explain what Pi, Core and the application each own | 5 minutes | Explanation and any incorrect assumptions |
| Find where to change instructions, add a Skill and call a tool | 15 minutes | Paths found, questions asked, wrong turns |
| Create an independent project and run a checked task | 30 minutes with credentials ready | Commands, run path and delivery result |
| Call Python and open the UI without reading Core source | During the exercise | Whether source inspection or coaching was needed |
| Explain task-page delivery versus native Pi Web chat | End of exercise | Participant's own explanation |

Let participants work from the docs. Record help rather than silently coaching;
separate installation/network/model failures from documentation problems.

## Result sheet

For each participant, record background, date, commit, environment, start/end
times, completion, help requested, confusing wording and specific blocked steps.
Keep credentials out of the notes. Report the observed results before changing
these proposed targets. Do not turn two participants' times into a general
success-rate claim. No human results have been collected for this revision.
