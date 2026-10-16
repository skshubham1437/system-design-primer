// Content validators. Each content type (quizzes, practice rubrics, choosers, glossary, ...)
// adds one module here exporting `validate(ctx) -> string[]` (a list of problems).
// Problems are fatal under STRICT=1 / CI, like the other structural checks.
import fs from 'node:fs';
import path from 'node:path';
import { validateQuizzes } from './quizzes.mjs';
import { validatePractice } from './practice.mjs';
import { validateChoosers } from './choosers.mjs';
import { validatePrereqs } from './prereqs.mjs';
import { validateDbExercises } from './db-exercises.mjs';
import { validateTraces } from '../lib/db-traces.mjs';
import { rules } from './rules.mjs';

export { rules };

/** Validators run on every build. Add new ones to this list as content types arrive. */
export const validators = [validateFeatures, validateQuizzes, validatePractice, validateChoosers, validatePrereqs, validateDbExercises, validateTraces];

export function runValidators(ctx, warn) {
  for (const v of validators) for (const problem of v(ctx)) warn(`${v.name}: ${problem}`, true);
}

function validateFeatures({ siteDir }) {
  const { check, problems } = rules();
  const file = path.join(siteDir, 'features.json');
  check(fs.existsSync(file), 'features.json is missing');
  if (!fs.existsSync(file)) return problems;
  const f = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(f)) if (!k.startsWith('_')) check(typeof v === 'boolean', `feature "${k}" must be true or false`);
  return problems;
}

export function readFeatures(siteDir) {
  const f = JSON.parse(fs.readFileSync(path.join(siteDir, 'features.json'), 'utf8'));
  return Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith('_')));
}
