/**
 * The terminal answerers for the two human-decision seams: one-shot tool
 * approval (`approval/request`) and structured questions
 * (`user-questions/request`). Each answers only for the Agent this surface
 * owns and delegates every other request with `next()`, matching the
 * fail-closed contracts of `@deepseek-ai/dsh-user-approval` and
 * `@deepseek-ai/dsh-user-questions`.
 * @module @hyperai/hyperai-harness-tui/answerers
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type { TuiSurface } from './view.ts'

/**
 * Register both answerers against the surface's modals.
 * @param ctx - plugin context carrying the waterfall events.
 * @param surface - the terminal surface presenting the decisions.
 * @param owns - decides whether this surface drives the asking agent.
 * @returns a disposer removing both listeners.
 */
export function registerAnswerers(
  ctx: Context,
  surface: TuiSurface,
  owns: (agent: Agent) => boolean,
): () => void {
  const disposeApproval = ctx.on('approval/request', async (req, next): Promise<ApprovalOutcome> => {
    if (!owns(req.agent)) return next()
    // An aborted request is already withdrawn: settle cancelled without a modal.
    if (req.signal?.aborted === true) return 'cancelled'
    return surface.askApproval(req.toolName, req.reason)
  })
  const disposeQuestions = ctx.on('user-questions/request', async (req, next): Promise<AskUserQuestionAnswer> => {
    const agent = req.agent
    if (agent === undefined || !owns(agent)) return next()
    if (req.signal?.aborted === true) {
      return { answers: req.questions.map(question => ({ id: question.id, selected: [] })) }
    }
    const answers = await surface.askQuestions(req.questions.map(question => ({
      id: question.id,
      question: question.question,
      ...question.detail === undefined ? {} : { detail: question.detail },
      ...question.options === undefined ? {} : {
        options: question.options.map(option => ({
          label: option.label,
          ...option.description === undefined ? {} : { description: option.description },
        })),
      },
      ...question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect },
    })))
    return { answers }
  })
  return () => {
    disposeApproval()
    disposeQuestions()
  }
}
