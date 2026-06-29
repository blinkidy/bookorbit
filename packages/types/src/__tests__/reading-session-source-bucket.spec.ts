import { describe, expect, it } from "vitest";

import {
  READING_SESSION_SOURCE_BUCKETS,
  READING_SESSION_SOURCE_BUCKET_LABELS,
  emptySourceBucketRecord,
  toReadingSessionSourceBucket,
} from "../reading-session-source-bucket";

describe("toReadingSessionSourceBucket", () => {
  it("maps web to bookorbit", () => {
    expect(toReadingSessionSourceBucket("web")).toBe("bookorbit");
  });

  it("maps manual to bookorbit", () => {
    expect(toReadingSessionSourceBucket("manual")).toBe("bookorbit");
  });

  it("maps koreader to koreader", () => {
    expect(toReadingSessionSourceBucket("koreader")).toBe("koreader");
  });

  it("maps kobo to kobo", () => {
    expect(toReadingSessionSourceBucket("kobo")).toBe("kobo");
  });

  it("maps audiobook to audiobook", () => {
    expect(toReadingSessionSourceBucket("audiobook")).toBe("audiobook");
  });

  it("maps null/undefined to bookorbit", () => {
    expect(toReadingSessionSourceBucket(null)).toBe("bookorbit");
    expect(toReadingSessionSourceBucket(undefined)).toBe("bookorbit");
  });
});

describe("reading session source bucket constants", () => {
  it("exposes exactly four buckets", () => {
    expect(READING_SESSION_SOURCE_BUCKETS).toEqual(["bookorbit", "koreader", "kobo", "audiobook"]);
  });

  it("labels every bucket", () => {
    expect(READING_SESSION_SOURCE_BUCKET_LABELS).toEqual({
      bookorbit: "BookOrbit",
      koreader: "KOReader",
      kobo: "Kobo",
      audiobook: "Audiobook",
    });
  });

  it("builds a zero-filled record", () => {
    expect(emptySourceBucketRecord()).toEqual({ bookorbit: 0, koreader: 0, kobo: 0, audiobook: 0 });
  });
});
