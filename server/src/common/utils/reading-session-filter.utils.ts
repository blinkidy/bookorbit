import { and, eq, gte, isNull, lt, ne, or } from 'drizzle-orm';

import { readingSessions } from '../../db/schema';
import { MIN_LOGGED_READING_PROGRESS_DELTA } from '../constants/reading-session.constants';

export function loggedReadingSessionFilter() {
  return or(
    isNull(readingSessions.source),
    ne(readingSessions.source, 'koreader'),
    gte(readingSessions.progressDelta, MIN_LOGGED_READING_PROGRESS_DELTA),
  )!;
}

export function noProgressKoreaderSessionFilter() {
  return and(
    eq(readingSessions.source, 'koreader'),
    or(isNull(readingSessions.progressDelta), lt(readingSessions.progressDelta, MIN_LOGGED_READING_PROGRESS_DELTA)),
  )!;
}
