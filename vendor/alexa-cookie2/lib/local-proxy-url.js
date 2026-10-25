'use strict';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveLocalProxyProtocol = (configured, forwarded, encrypted) => {
  if (configured === 'http' || configured === 'https') {
    return configured;
  }
  const forwardedProtocol = String(forwarded || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return forwardedProtocol === 'https' || encrypted ? 'https' : 'http';
};

const normalizeLocalProxyScheme = (value, host, port, protocol) => {
  if (
    typeof value !== 'string' ||
    !host ||
    !port ||
    !['http', 'https'].includes(protocol)
  ) {
    return value;
  }
  const localAuthority = `${host}:${port}`;
  const plainPattern = new RegExp(
    `https?://${escapeRegex(localAuthority)}(?=/|$)`,
    'gi',
  );
  const escapedPattern = new RegExp(
    `https?:\\\\/\\\\/${escapeRegex(localAuthority)}(?=\\\\/|$)`,
    'gi',
  );
  const encodedPattern = new RegExp(
    `https?%3A%2F%2F${escapeRegex(host)}%3A${port}(?=%2F|$)`,
    'gi',
  );

  return value
    .replace(plainPattern, `${protocol}://${localAuthority}`)
    .replace(escapedPattern, `${protocol}:\\/\\/${localAuthority}`)
    .replace(
      encodedPattern,
      `${protocol}%3A%2F%2F${host}%3A${port}`,
    );
};

module.exports = { normalizeLocalProxyScheme, resolveLocalProxyProtocol };
