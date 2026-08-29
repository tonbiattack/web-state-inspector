export function networkBodyText(body) {
    return body.available ? body.text ?? '' : `Not available: ${body.reason ?? 'Unknown reason.'}`;
}
/** Formats one recorded exchange without masking or sending any captured value. */
export function formatNetworkExchange(entry) {
    return [
        `# ${entry.method} ${entry.url}`,
        `When: ${entry.timestamp}`,
        `Duration: ${entry.durationMs} ms`,
        `Type: ${entry.resourceType ?? 'Not available'}`,
        '',
        '## Request',
        'Headers:',
        JSON.stringify(entry.requestHeaders, null, 2),
        '',
        'Body:',
        networkBodyText(entry.requestBody),
        '',
        '## Response',
        `Status: ${entry.status || 'Not available'} ${entry.statusText}`,
        'Headers:',
        JSON.stringify(entry.responseHeaders, null, 2),
        '',
        'Body:',
        networkBodyText(entry.responseBody),
    ].join('\n');
}
