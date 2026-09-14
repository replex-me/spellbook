import { describe, expect, it } from "vitest";

import {
  buildExpectedWopiProof,
  parseWopiProofKeys,
  rawQueryParameter,
  verifyWopiProof,
} from "./wopi-proof";

// Known-good vector from Microsoft's MIT-licensed WOPI proof-key sample.
// https://github.com/microsoft/Office-Online-Test-Tools-and-Documentation
const timestamp = "635655897610773532";
const accessToken =
  "yZhdN1qgywcOQWhyEMVpB6NE3pvBksvcLXsrFKXNtBeDTPW%2fu62g2t%2fOCWSlb3jUGaz1zc%2fzOzbNgAredLdhQI1Q7sPPqUv2owO78olmN74DV%2fv52OZIkBG%2b8jqjwmUobcjXVIC1BG9g%2fynMN0itZklL2x27Z2imCF6xELcQUuGdkoXBj%2bI%2bTlKM";
const requestUrl =
  "https://contoso.com/wopi/files/vHxYyRGM8VfmSGwGYDBMIQPzuE+sSC6kw+zWZw2Nyg?access_token=" +
  accessToken;
const proof =
  "IflL8OWCOCmws5qnDD5kYMraMGI3o+T+hojoDREbjZSkxbbx7XIS1Av85lohPKjyksocpeVwqEYm9nVWfnq05uhDNGp2MsNyhPO9unZ6w25Rjs1hDFM0dmvYx8wlQBNZ/CFPaz3inCMaaP4PtU85YepaDccAjNc1gikdy3kSMeG1XZuaDixHvMKzF/60DMfLMBIu5xP4Nt8i8Gi2oZs4REuxi6yxOv2vQJQ5+8Wu2Olm8qZvT4FEIQT9oZAXebn/CxyvyQv+RVpoU2gb4BreXAdfKthWF67GpJyhr+ibEVDoIIolUvviycyEtjsaEBpOf6Ne/OLRNu98un7WNDzMTQ==";
const keys = {
  current: {
    modulus:
      "0HOWUPFFgmSYHbLZZzdWO/HUOr8YNfx5NAl7GUytooHZ7B9QxQKTJpj0NIJ4XEskQW8e4dLzRrPbNOOJ+KpWHttXz8HoQXkkZV/gYNxaNHJ8/pRXGMZzfVM5vchhx/2C7ULPTrpBsSpmfWQ6ShaVoQzfThFUd0MsBvIN7HVtqzPx9jbSV04wAqyNjcro7F3iu9w7AEsMejHbFlWoN+J05dP5ixryF7+2U5RVmjMt7/dYUdCoiXvCMt2CaVr0XEG6udHU4iDKVKZjmUBc7cTWRzhqEL7lZ1yQfylp38Nd2xxVJ0sSU7OkC1bBDlePcYGaF3JjJgsmp/H5BNnlW9gSxQ==",
    exponent: "AQAB",
  },
  old: {
    modulus:
      "u/ppb/da4jeKQ+XzKr69VJTqR7wgQp2jzDIaEPQVzfwod+pc1zvO7cwjNgfzF/KQGkltoOi9KdtMzR0qmX8C5wZI6wGpS8S4pTFAZPhXg5w4EpyR8fAagrnlOgaVLs0oX5UuBqKndCQyM7Vj5nFd+r53giS0ch7zDW0uB1G+ZWqTZ1TwbtV6dmlpVuJYeIPonOJgo2iuh455KuS2gvxZKOKR27Uq7W949oM8sqRjvfaVf4xDmyor++98XX0zadnf4pMWfPr3XE+bCXtB9jIPAxxMrALf5ncNRhnx0Wyf8zfM7Rfq+omp/HxCgusF5MC2/Ffnn7me/628zzioAMy5pQ==",
    exponent: "AQAB",
  },
};
const sampleTimeMs = Number(
  (BigInt(timestamp) - 621_355_968_000_000_000n) / 10_000n,
);

describe("WOPI proof-key validation", () => {
  it("matches Microsoft's published current-key test vector", () => {
    expect(
      verifyWopiProof(
        {
          accessToken,
          requestUrl,
          timestamp,
          proof,
          oldProof: "invalid",
        },
        keys,
        sampleTimeMs,
      ),
    ).toBe("current-proof-current-key");
  });

  it("rejects changed signatures and timestamps outside the 20-minute window", () => {
    const input = {
      accessToken,
      requestUrl,
      timestamp,
      proof: `${proof.slice(0, -4)}AAAA`,
      oldProof: "invalid",
    };
    expect(verifyWopiProof(input, keys, sampleTimeMs)).toBeNull();
    expect(
      verifyWopiProof(
        { ...input, proof },
        keys,
        sampleTimeMs + 20 * 60_000 + 1,
      ),
    ).toBeNull();
  });

  it("preserves the encoded access token and includes the full uppercased URL", () => {
    expect(rawQueryParameter(requestUrl, "access_token")).toBe(accessToken);
    const expected = buildExpectedWopiProof({
      accessToken,
      requestUrl,
      timestamp,
    });
    expect(expected.includes(Buffer.from(requestUrl.toUpperCase()))).toBe(true);
  });

  it("reads both RSA keys from discovery", () => {
    expect(
      parseWopiProofKeys(
        `<wopi-discovery><proof-key modulus="${keys.current.modulus}" exponent="AQAB" oldmodulus="${keys.old.modulus}" oldexponent="AQAB" value="ignored" oldvalue="ignored"/></wopi-discovery>`,
      ),
    ).toEqual(keys);
    expect(() => parseWopiProofKeys("<wopi-discovery/>")).toThrow(
      "office_proof_keys_not_discovered",
    );
  });
});
