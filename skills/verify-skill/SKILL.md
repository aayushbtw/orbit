---
name: verify-skill
description: Create or maintain a project's verification skill, so Claude can drive the real app or library and show proof that a change works
argument-hint: create | maintain
disable-model-invocation: true
---
Mode: $ARGUMENTS

A verification skill lets an agent use the project the way a user does and capture proof. It lives in `.claude/skills/verify-<project>/`: a SKILL.md, one control script, and a feature map. Write it for an agent that reads it cold, mid-task, and has never seen the project.

## create

1. **Read the repo, not the user.** Ask only what the code can't tell you.
   - Entry point: what a user touches. A web UI, a CLI, an API, or a library someone installs. Pick the main one and note the rest.
   - Run: the repo's own dev or build command, ports, env, seed data, auth.
   - Drive: existing harnesses first (Playwright specs, example apps, fixtures). Otherwise use Playwright for a web UI, a child process with captured output for a CLI, fetch for an API, and a scratch consumer project for a library.
   - Proof: screenshots, stdout, stderr and exit code, response bodies, files written.
   - Isolation: can two runs go side by side (ports, temp dirs)? If not, the skill says so.

   If the project doesn't build or start, fix that or report it before going on.
2. **Write the control script** in the repo's own language, eg `control.ts`, and make it pass the project check like any other code. One subcommand per action. Each one:
   - prints JSON on stdout
   - fails with an error that says what to do instead
   - is described in the script's `--help`
   - has a timeout, so a command that never exits can't hang the agent
   - takes `--dry-run` when it deletes or writes outside its own temp dir

   Always include `doctor` (read-only: is this instance worth driving?) and `cleanup` (removes only what the script started, never the evidence). Evidence goes to one named directory, server logs included. Let a server pick its own free port and read the url from its output, so runs can go side by side.
3. **Write SKILL.md.** Frontmatter `name: verify-<project>` and a `description` that names the project and its surface and says to use it to prove a change works. Sections: Launch (command, ready signal, teardown), Doctor, Drive (real commands from this repo), Proof, Cleanup. Proof states these rules:
   - Use the real user path, not internal setters or test-only hooks.
   - Capture the action and its result, not only the final state.
   - Check side effects (files, rows, output) as well as what is visible.
   - Cleanup never deletes evidence.
4. **Seed the feature map**: `features/README.md` (index and baseline preconditions) and one file for each of the top 3 to 5 user-facing features. Each file has these H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it`, `Gotchas`. Name user paths and commands, not implementation.
5. **Prove it.** Follow the new skill end to end once: launch, doctor, drive one mapped feature, capture proof, clean up. Confirm the proof survived cleanup. Fix and rerun until it passes, and run cleanup after every failed try. A skill nobody has run is a draft.

## maintain

Edit only the verification skill's folder. Never change product code here.

1. Find `.claude/skills/verify-*/`. None: stop and say to run `/verify-skill create`.
2. Fix the index: missing, extra or dead feature entries.
3. For each feature file, read the source it describes and note drift with `file:line`. Use parallel `Explore` agents when there are more than 3 features.
4. Read commits since the skill last changed for user-facing features the map lacks.
5. Drive every feature live. Run doctor first, and again after any failed drive.
6. Sort each finding. Wrong description: fix the map. Works but the script can't drive it: fix the script, then drive it again. Product actually broken: report it, and don't change the map to match.
7. Report one outcome: clean, changed (commit through gitops), or blocked (say what blocked it).
