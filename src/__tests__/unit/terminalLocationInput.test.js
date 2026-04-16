/**
 * Regression test for createTerminalLocation input-shape handling.
 *
 * Duplicates the tiny normalization logic that lives in functions/index.js
 * createTerminalLocation so we can verify both input shapes are accepted and
 * that the validation guard trips only when genuinely required fields are
 * missing. Without this, the whole Terminal setup flow breaks on Step 1
 * (form sends flat shape, function used to expect nested).
 */

function normalizeLocationInput(requestData) {
  const data = requestData || {};
  const displayName = data.displayName;
  const address = data.address || {
    line1: data.addressLine1,
    city: data.city,
    state: data.state,
    postal_code: data.postalCode,
    country: data.country,
  };
  const valid =
    !!displayName &&
    !!address.line1 &&
    !!address.city &&
    !!address.state &&
    !!address.postal_code;
  return { displayName, address, valid };
}

describe('createTerminalLocation input normalization', () => {
  it('accepts the flat shape the UI form sends', () => {
    const result = normalizeLocationInput({
      displayName: 'Koda Diner',
      addressLine1: '123 Main St',
      city: 'Boise',
      state: 'ID',
      postalCode: '83702',
      country: 'US',
    });
    expect(result.valid).toBe(true);
    expect(result.address).toEqual({
      line1: '123 Main St',
      city: 'Boise',
      state: 'ID',
      postal_code: '83702',
      country: 'US',
    });
  });

  it('still accepts the nested Stripe-API shape for back-compat', () => {
    const result = normalizeLocationInput({
      displayName: 'Koda Diner',
      address: {
        line1: '456 Elm',
        city: 'Reno',
        state: 'NV',
        postal_code: '89501',
        country: 'US',
      },
    });
    expect(result.valid).toBe(true);
    expect(result.address.line1).toBe('456 Elm');
    expect(result.address.postal_code).toBe('89501');
  });

  it('rejects when postalCode is missing (flat shape)', () => {
    const result = normalizeLocationInput({
      displayName: 'Missing Zip',
      addressLine1: '1 A St',
      city: 'Somewhere',
      state: 'CA',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects when displayName is missing', () => {
    const result = normalizeLocationInput({
      addressLine1: '1 A St',
      city: 'Somewhere',
      state: 'CA',
      postalCode: '90000',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects empty payload without throwing', () => {
    expect(() => normalizeLocationInput()).not.toThrow();
    expect(normalizeLocationInput().valid).toBe(false);
    expect(normalizeLocationInput(null).valid).toBe(false);
    expect(normalizeLocationInput({}).valid).toBe(false);
  });

  it('prefers the nested address over flat fields when both are provided', () => {
    const result = normalizeLocationInput({
      displayName: 'Both',
      addressLine1: 'SHOULD_IGNORE',
      address: {
        line1: 'USE_ME',
        city: 'X',
        state: 'Y',
        postal_code: '11111',
      },
    });
    expect(result.address.line1).toBe('USE_ME');
  });
});
