export function calculateBackoffSeconds(attemptNumber: number): number {
    const delaysInSeconds = [
        10,   // after attempt 1
        30,   // after attempt 2
        120,  // after attempt 3
        300,  // after attempt 4
        900,  // after attempt 5+
    ];

    const index = Math.max(0, attemptNumber - 1);

    return delaysInSeconds[Math.min(index, delaysInSeconds.length - 1)];
}