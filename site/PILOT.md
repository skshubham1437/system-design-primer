# Quiz pilot (Gate A)

Three topics have quizzes: **Cache**, **Database** and **Load balancer** (19 questions). Before writing the other ~80 questions, find out whether the format works and whether the questions are right. This is the protocol.

## What we are trying to learn

1. Do learners score higher after studying than before? (Does the quiz measure and support learning?)
2. Are the questions correct, unambiguous and fair?
3. Do learners use the explanations and the "Read the section" links?
4. Is anything confusing in the interface?

## Who

Five people who have **not** already studied these three topics in depth. Mix of experience: at least one beginner and one working engineer. Include one person using a phone and one using only a keyboard.

## Before you start

1. Set `reviewed: false` stays as it is. The quizzes show a "Draft" notice; that is intended.
2. Make sure the site is deployed (or running with `npm run preview`) and that each participant uses a fresh browser profile or private window, so no earlier progress is present.

## Session (about 40 minutes each, can be done alone)

| Step | What the learner does | Time |
|---|---|---|
| 1. Cold test | Take all three quizzes **without reading the topic pages first**. Write down the scores. Do not look anything up | 10 min |
| 2. Study | Read the three topic pages normally | 15 min |
| 3. Retake | Take the three quizzes again | 8 min |
| 4. Feedback | Answer the questions below | 7 min |

The scores are shown on the results screen and on **Your progress**. Ask each learner to export their progress at the end (**About, then Your data, then Export progress**) and send you the file. Nothing is collected automatically.

## Feedback questions

- Which question, if any, did you find unclear, or think had the wrong answer? (Give the wording.)
- Did you click "Read the section" at any point? Was it useful?
- Was there anything you could not do, or did not understand how to do?
- Did the quiz feel too easy, too hard, or about right?
- Would you use this for the other topics? What would make it better?

## Reading the results

From each exported file, look at `quiz.attempts` (each has `id`, `score`, `of`, `at`). Compare the first attempt with the last for each of `cache`, `database` and `load-balancer`.

## Decision rule

Continue to the remaining topics only if **all** of these hold:

- [ ] Most learners improved between the cold test and the retake.
- [ ] No question was reported as wrong. If one was, it is fixed and a second person re-checks **all** the questions on that topic.
- [ ] Fewer than 1 question in 20 needed any correction after review (19 questions: at most one).
- [ ] No learner was unable to finish a quiz because of the interface.

If one fails, change the format or the content and run a smaller second pilot. Do not write more questions on a format that has not been shown to work.

## After the pilot

1. Fix what was found, then have a **second person** (not the author) check every answer against its linked section using the checklist in [CONTENT_GUIDE.md](CONTENT_GUIDE.md).
2. Only then set `reviewed: true` in each quiz file. That removes the "Draft" notice.
3. Record the outcome in the Status table of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and decide whether to proceed with task Q8.
