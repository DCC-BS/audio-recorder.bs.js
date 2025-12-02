export function toPcmData(pcmArrays: Float32Array[]) {
    const length = pcmArrays.reduce(
        (acc: number, arr: Float32Array) => acc + arr.length,
        0,
    );
    const pcmData = new Float32Array(length);
    let offset = 0;
    for (const chunk of pcmArrays) {
        pcmData.set(chunk, offset);
        offset += chunk.length;
    }

    return pcmData;
}
