import type { ModalityId } from '../constants'
import type { DeviationBand } from './types'

const WITHIN_BASELINE_TEXT =
  'This was within your usual range for this modality — no significant deviation from your baseline this week.'

/** Static placeholder copy for Level 3 until on-device model text is wired. */
export function modalityObservationText(
  modality: ModalityId,
  band: DeviationBand,
): string {
  const copy: Record<ModalityId, Record<'above' | 'below', string>> = {
    'Vocal Prosody': {
      above:
        'Pitch and tempo were elevated above your usual pattern — this can be associated with heightened emotional activation, excitement, or stress.',
      below:
        'Speech was slower and flatter than your usual pattern — this can be associated with fatigue, low energy, or a quieter emotional state.',
    },
    'Thermal Imaging': {
      above:
        'Facial blood flow was higher than your usual pattern, particularly around the eyes and nose — this can be associated with emotional arousal, physical exertion, or cognitive load.',
      below:
        'Facial temperature was cooler than your usual pattern — the nose tip in particular cools during sustained calm or low stimulation states.',
    },
    'Micro-expressions': {
      above:
        'Involuntary facial muscle activity was more frequent than usual — jaw tension, brow movement, or frowning appeared more than your baseline — this can be associated with concentration, emotional processing, or stress.',
      below:
        'Facial muscle activity was quieter than usual — fewer micro-expressions than your baseline — this can be associated with relaxation, disengagement, or low emotional activation.',
    },
    'Gait and Posture': {
      above:
        'Shoulder tension and postural compression were higher than your usual pattern — this can be associated with stress, physical fatigue, or sustained concentration.',
      below:
        'Posture was more open and movement quality was more fluid than your usual pattern — this can be associated with ease, comfort, or physical relaxation.',
    },
    'Physical Movement': {
      above:
        'You moved through the space faster and interacted with the environment more frequently than usual — this can be associated with agitation, urgency, high energy, or busyness.',
      below:
        'Movement through the space was slower and less frequent than usual — this can be associated with rest, low energy, or a quieter day.',
    },
  }

  if (band === 'within') return WITHIN_BASELINE_TEXT
  return copy[modality][band]
}
