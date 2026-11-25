import { describe, it, expect } from 'vitest'
import { ImagePuller, countLayers, describePull, parsePullOutput } from '../imagePull'

const OUTPUT = `latest: Pulling from darthtigerson/universe-base
aaaaaaaaaaaa: Already exists
bbbbbbbbbbbb: Pulling fs layer
cccccccccccc: Pulling fs layer
bbbbbbbbbbbb: Download complete
bbbbbbbbbbbb: Pull complete
cccccccccccc: Downloading
`

describe('pull output', () => {
  it('counts finished layers out of those announced', () => {
    const layers = new Map<string, string>()
    parsePullOutput(OUTPUT, layers)
    expect(countLayers(layers)).toEqual({ done: 2, total: 3 })
  })
  it('handles lines split across chunks the way docker writes them (whole lines)', () => {
    const layers = new Map<string, string>()
    for (const line of OUTPUT.split('\n')) parsePullOutput(line + '\n', layers)
    expect(countLayers(layers)).toEqual({ done: 2, total: 3 })
  })
  it('describes progress for the agent', () => {
    expect(describePull({ image: 'x', state: 'pulling', layersDone: 2, layersTotal: 5 })).toBe('downloading, 2 of 5 layers done')
    expect(describePull({ image: 'x', state: 'pulling', layersDone: 0, layersTotal: 0 })).toBe('downloading')
  })
})

describe('ImagePuller', () => {
  it('runs one pull per image and reports its end to every waiter', async () => {
    let exit: (c: number) => void = () => {}
    const runs: string[][] = []
    const puller = new ImagePuller((_b, a, h) => { runs.push(a); exit = (c) => h.onExit?.(c); return { kill() {} } })
    puller.start('img')
    puller.start('img')
    const w1 = puller.wait('img', 1000)
    const w2 = puller.wait('img', 1000)
    exit(0)
    expect((await w1).state).toBe('ready')
    expect((await w2).state).toBe('ready')
    expect(runs).toEqual([['pull', 'img']])
  })
  it('keeps the error tail of a failed pull and allows a retry', async () => {
    const runs: number[] = []
    const puller = new ImagePuller((_b, _a, h) => { runs.push(1); setTimeout(() => { h.onStderr?.('denied: requested access'); h.onExit?.(1) }, 0); return { kill() {} } })
    puller.start('img')
    const p = await puller.wait('img', 1000)
    expect(p.state).toBe('failed')
    expect(p.error).toMatch(/denied/)
    puller.start('img')
    expect(runs).toHaveLength(2)
  })
  it('wait gives up after the timeout while the pull carries on', async () => {
    const puller = new ImagePuller(() => ({ kill() {} }))
    puller.start('img')
    expect((await puller.wait('img', 5)).state).toBe('pulling')
    expect(puller.status('img').state).toBe('pulling')
  })
})
