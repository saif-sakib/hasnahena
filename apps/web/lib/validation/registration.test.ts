import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  bdPhoneRegex,
  bdNidRegex,
  registerApiSchema,
  registerSchema,
  REGISTRATION_UPLOAD_LIMITS,
  getRegistrationFieldLabel,
} from './registration';

// These two decide who can become a member. They run on the signup form and
// again in the route handler, and a member whose phone was accepted in the wrong
// shape cannot log in — phone is a login identifier (FR-01).

describe('bdPhoneRegex', () => {
  it('accepts every operator prefix in use', () => {
    // 013 Grameenphone, 014 Banglalink, 015 Teletalk, 016 Airtel,
    // 017 Grameenphone, 018 Robi, 019 Banglalink.
    for (const prefix of ['013', '014', '015', '016', '017', '018', '019']) {
      expect(bdPhoneRegex.test(`${prefix}12345678`)).toBe(true);
    }
  });

  it('requires exactly 11 digits', () => {
    expect(bdPhoneRegex.test('0171234567')).toBe(false);   // 10
    expect(bdPhoneRegex.test('017123456789')).toBe(false); // 12
  });

  it('rejects the formats people actually type', () => {
    for (const input of [
      '+8801712345678',   // international prefix
      '8801712345678',    // country code, no plus
      '01712-345678',     // hyphenated
      '01712 345678',     // spaced
      ' 01712345678',     // leading space
      '01712345678 ',     // trailing space
      '11712345678',      // does not start 01
      '',
    ]) {
      expect(bdPhoneRegex.test(input)).toBe(false);
    }
  });

  it('is anchored at both ends', () => {
    // Without anchors a pasted line of text containing a valid number would
    // pass, and the stored identifier would carry the surrounding characters.
    expect(bdPhoneRegex.test('call me on 01712345678 please')).toBe(false);
  });
});

describe('bdNidRegex', () => {
  it('accepts the three lengths Bangladesh issues', () => {
    expect(bdNidRegex.test('1'.repeat(10))).toBe(true); // old
    expect(bdNidRegex.test('1'.repeat(13))).toBe(true); // old, with birth year
    expect(bdNidRegex.test('1'.repeat(17))).toBe(true); // smart card
  });

  it('rejects lengths in between, which are transcription errors', () => {
    for (const len of [9, 11, 12, 14, 15, 16, 18]) {
      expect(bdNidRegex.test('1'.repeat(len))).toBe(false);
    }
  });

  it('rejects non-digits and separators', () => {
    for (const input of ['123 456 7890', '1234-567890', 'abcdefghij', '']) {
      expect(bdNidRegex.test(input)).toBe(false);
    }
  });

  it('is anchored, so a long string containing a valid NID does not pass', () => {
    expect(bdNidRegex.test('nid:1234567890')).toBe(false);
    expect(bdNidRegex.test('1'.repeat(10) + 'x')).toBe(false);
  });
});

/** A submission with every required field correctly filled. */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    nameEn: 'Abdul Karim',
    nameBn: 'আব্দুল করিম',
    fatherName: 'Mohammad Ali',
    motherName: 'Fatema Begum',
    phone: '01712345678',
    email: 'karim@example.com',
    nidNumber: '1234567890',
    maritalStatus: 'MARRIED',
    childrenCount: 2,
    gender: 'MALE',
    bloodGroup: 'B+',
    profession: 'Farmer',
    dateOfBirth: '1990-04-12',
    permanentHouseNo: '12',
    permanentVillage: 'Bhekutia',
    permanentUnion: 'Sadar',
    permanentPoliceStation: 'Kotwali',
    permanentDistrict: 'Jashore',
    sameAsPermanent: true,
    nomineeName: 'Fatema Begum',
    nomineeRelationship: 'Mother',
    nomineeNid: '9876543210',
    ...overrides,
  };
}

/** Top-level field names an issue was reported against. */
function issuePaths(result: z.SafeParseReturnType<unknown, unknown>): string[] {
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.'));
}

describe('registerApiSchema', () => {
  it('accepts a complete submission', () => {
    expect(registerApiSchema.safeParse(validPayload()).success).toBe(true);
  });

  // The form navigates a member to the step that owns a failing field by
  // matching the issue path against a per-step field list. An issue reported
  // against a path that is not a single top-level field name has no step to go
  // to, which is what produced a "form needs attention" message pointing at
  // nothing. The page handles that case explicitly now; this pins the set of
  // shapes it has to handle.
  it('reports field problems against a single top-level key', () => {
    const broken = registerApiSchema.safeParse(
      validPayload({ nameEn: 'A', phone: 'x', nidNumber: '12', profession: '' }),
    );
    expect(broken.success).toBe(false);
    for (const path of issuePaths(broken)) {
      expect(path).not.toBe('');
      expect(path).not.toContain('.');
    }
    expect(issuePaths(broken).sort()).toEqual(
      ['nameEn', 'nidNumber', 'phone', 'profession'].sort(),
    );
  });

  it('every field it can name has a human label in both languages', () => {
    // The submit-time error banner lists failing fields by label. A field with
    // no entry falls back to its raw key, which is how a member ends up being
    // told to fix "permanentPoliceStation".
    const broken = registerApiSchema.safeParse({});
    for (const path of issuePaths(broken)) {
      expect(getRegistrationFieldLabel(path, 'en')).not.toBe(path);
      expect(getRegistrationFieldLabel(path, 'bn')).not.toBe(path);
    }
  });

  describe('present address', () => {
    it('may be omitted entirely when it matches the permanent one', () => {
      const result = registerApiSchema.safeParse(validPayload({ sameAsPermanent: true }));
      expect(result.success).toBe(true);
    });

    it('names each missing part when it differs', () => {
      const result = registerApiSchema.safeParse(validPayload({ sameAsPermanent: false }));
      expect(issuePaths(result).sort()).toEqual(
        [
          'presentDistrict',
          'presentHouseNo',
          'presentPoliceStation',
          'presentUnion',
          'presentVillage',
        ].sort(),
      );
    });

    it('treats whitespace as missing rather than as an address', () => {
      const result = registerApiSchema.safeParse(
        validPayload({
          sameAsPermanent: false,
          presentHouseNo: '   ',
          presentVillage: 'Nowapara',
          presentUnion: 'Sadar',
          presentPoliceStation: 'Kotwali',
          presentDistrict: 'Jashore',
        }),
      );
      expect(issuePaths(result)).toEqual(['presentHouseNo']);
    });

    it('leaves road number optional on both addresses', () => {
      const result = registerApiSchema.safeParse(
        validPayload({
          sameAsPermanent: false,
          presentHouseNo: '5',
          presentVillage: 'Nowapara',
          presentUnion: 'Sadar',
          presentPoliceStation: 'Kotwali',
          presentDistrict: 'Jashore',
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('children count', () => {
    it('must be zero for an unmarried applicant', () => {
      const result = registerApiSchema.safeParse(
        validPayload({ maritalStatus: 'UNMARRIED', childrenCount: 2 }),
      );
      expect(issuePaths(result)).toEqual(['childrenCount']);
    });

    it('accepts zero and omission for an unmarried applicant', () => {
      for (const childrenCount of [0, undefined, '', null]) {
        const result = registerApiSchema.safeParse(
          validPayload({ maritalStatus: 'UNMARRIED', childrenCount }),
        );
        expect(result.success).toBe(true);
      }
    });

    it('rejects negatives, fractions and implausible counts', () => {
      for (const childrenCount of [-1, 2.5, 21]) {
        const result = registerApiSchema.safeParse(validPayload({ childrenCount }));
        expect(issuePaths(result)).toEqual(['childrenCount']);
      }
    });

    it('treats an emptied number input as unanswered, not as invalid', () => {
      // A cleared <input type="number"> registered with valueAsNumber yields
      // NaN, and JSON.stringify turns NaN into null on the way to the server.
      // Both have to mean "not answered" or a member who backspaces the field
      // is blocked by an error on a box they deliberately left empty.
      expect(registerApiSchema.safeParse(validPayload({ childrenCount: NaN })).success).toBe(true);
      expect(registerApiSchema.safeParse(validPayload({ childrenCount: null })).success).toBe(true);
    });
  });

  describe('date of birth', () => {
    it('rejects a future date', () => {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      expect(issuePaths(registerApiSchema.safeParse(validPayload({ dateOfBirth: tomorrow })))).toEqual(
        ['dateOfBirth'],
      );
    });

    it('rejects an unparseable date and an empty one', () => {
      for (const dateOfBirth of ['not-a-date', '', '1990-13-45']) {
        const result = registerApiSchema.safeParse(validPayload({ dateOfBirth }));
        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain('dateOfBirth');
      }
    });
  });

  describe('nominee phone', () => {
    it('is optional', () => {
      for (const nomineePhone of ['', undefined]) {
        expect(registerApiSchema.safeParse(validPayload({ nomineePhone })).success).toBe(true);
      }
    });

    it('must be a real Bangladeshi mobile when given', () => {
      expect(issuePaths(registerApiSchema.safeParse(validPayload({ nomineePhone: '12345' })))).toEqual(
        ['nomineePhone'],
      );
    });
  });

  it('rejects unknown keys outright', () => {
    // The schema is strict, so a client sending an extra field is refused
    // rather than having it silently dropped. The resulting issue carries an
    // empty path — the one shape that maps to no step, which is why the form
    // has a fallback branch for it.
    const result = registerApiSchema.safeParse(validPayload({ isAdmin: true }));
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(['']);
  });

  it('does not accept agreement in place of the API contract', () => {
    // agreeToTerms is a browser-form concern; the API schema is strict and
    // must not quietly grow a field the server never checks.
    expect(registerApiSchema.safeParse(validPayload({ agreeToTerms: true })).success).toBe(false);
  });
});

describe('registerSchema (browser form)', () => {
  it('requires the agreement to be ticked', () => {
    expect(issuePaths(registerSchema.safeParse(validPayload()))).toEqual(['agreeToTerms']);
    expect(issuePaths(registerSchema.safeParse(validPayload({ agreeToTerms: false })))).toEqual([
      'agreeToTerms',
    ]);
    expect(registerSchema.safeParse(validPayload({ agreeToTerms: true })).success).toBe(true);
  });
});

describe('REGISTRATION_UPLOAD_LIMITS', () => {
  it('keeps the total below the 4.5 MB serverless request-body cap', () => {
    // Above that the platform rejects the request before the route runs, and
    // the member gets an error page instead of something they can act on.
    expect(REGISTRATION_UPLOAD_LIMITS.TOTAL_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });

  it('states a total that four per-file limits can actually exceed', () => {
    // If four files could never breach the total, the total check is dead code
    // and the real ceiling is silently 4x the per-file limit.
    const fourFilesMax = REGISTRATION_UPLOAD_LIMITS.PER_FILE_MB * 4 * 1024 * 1024;
    expect(fourFilesMax).toBeGreaterThan(REGISTRATION_UPLOAD_LIMITS.TOTAL_BYTES);
  });

  it('labels the total with the number it actually enforces', () => {
    // Both error messages used to say 3.5 MB while the constant was 40 MB.
    const mb = REGISTRATION_UPLOAD_LIMITS.TOTAL_BYTES / (1024 * 1024);
    expect(REGISTRATION_UPLOAD_LIMITS.TOTAL_LABEL).toBe(`${mb} MB`);
  });
});
