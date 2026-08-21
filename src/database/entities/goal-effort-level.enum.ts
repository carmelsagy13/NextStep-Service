/**
 * How much work a task demands of the user. Authored as a default on the
 * {@link RoadmapGoal} template and optionally overridden per user task by the
 * reconciliation LLM.
 *
 *   QUICK    → a few minutes, one sitting.
 *   MODERATE → around half an hour, or a short ongoing habit.
 *   PROJECT  → a multi-session effort spanning weeks or more.
 *
 * Lives in its own module because both `RoadmapGoal` and `UserGoal` use it, and
 * those two entities already reference each other — importing the enum from
 * either one would leave it undefined at decorator-evaluation time.
 */
export enum GoalEffortLevel {
  QUICK = 'quick',
  MODERATE = 'moderate',
  PROJECT = 'project',
}
