'use strict'
/* eslint-disable @typescript-eslint/explicit-function-return-type */

const DEFAULT_MIN_DELAY_MS = 35
const DEFAULT_MAX_DELAY_MS = 55

const getNonNegativeNumber = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback
}

const typeStringWithDelay = async (options) => {
  const characters = Array.from(String(options.text ?? ''))
  const rawMinDelay = getNonNegativeNumber(options.minDelayMs, DEFAULT_MIN_DELAY_MS)
  const rawMaxDelay = getNonNegativeNumber(options.maxDelayMs, DEFAULT_MAX_DELAY_MS)
  const minDelayMs = Math.min(rawMinDelay, rawMaxDelay)
  const maxDelayMs = Math.max(rawMinDelay, rawMaxDelay)
  const isCancelled = options.isCancelled || (() => false)
  const random = options.random || Math.random
  let charactersTyped = 0

  for (const character of characters) {
    if (isCancelled()) return { completed: false, charactersTyped }

    if (character === '\n') {
      await options.keyTap('enter', ['shift'])
    } else {
      await options.typeString(character)
    }
    charactersTyped += 1

    if (isCancelled()) return { completed: false, charactersTyped }
    const delayMs = Math.round(minDelayMs + random() * (maxDelayMs - minDelayMs))
    await options.sleep(delayMs)
  }

  return { completed: true, charactersTyped }
}

module.exports = {
  typeStringWithDelay
}
