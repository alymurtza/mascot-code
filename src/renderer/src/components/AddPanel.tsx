import { useState, type JSX } from 'react'
import { api } from '../bridge'
import { answer, closeJob, isFinal, retryFailed, type AddItem } from '../adding'
import { report, set, toast, useApp } from '../store'
import { questionFor } from './DuplicateDialog'

/** Links being added in the background: progress, a question about a duplicate, and the links
 * that failed to try again or copy. Shrinks to a pill. */
export function AddPanel(): JSX.Element | null {
  const job = useApp((s) => s.addJob)
  const [rest, setRest] = useState(false)
  if (!job) return null
  const total = job.items.length
  const checked = job.items.filter((it) => !['waiting', 'checking'].includes(it.state)).length
  const dealt = job.items.filter((it) => isFinal(it.state)).length
  const count = (state: AddItem['state']): number =>
    job.items.filter((it) => it.state === state).length
  const failed = job.items.filter((it) => it.state === 'failed')
  const progress = job.running ? (checked + dealt) / (2 * total) : 1
  const line =
    job.step === 'check' ? `Checking links: ${checked} of ${total}` : `Adding: ${dealt} of ${total}`
  const setSmall = (small: boolean): void =>
    set((s) => (s.addJob ? { addJob: { ...s.addJob, small } } : {}))
  const q = job.questions[0]
  const waitingCount = job.questions.length

  if (job.small && job.running)
    return (
      <button
        className="add-pill"
        type="button"
        aria-label="Show links being added"
        onClick={() => setSmall(false)}
      >
        <span className="add-ring" style={{ ['--p' as string]: `${progress * 100}%` }} />
        <span>
          Adding links {dealt} of {total}
        </span>
        {q && (
          <span className="add-q">
            {waitingCount} question{waitingCount === 1 ? '' : 's'}
          </span>
        )}
      </button>
    )

  const added = count('added')
  const title = job.running
    ? `Adding ${total} link${total === 1 ? '' : 's'}`
    : `Added ${added} download${added === 1 ? '' : 's'}`
  const question = q ? questionFor(q.match, true) : null
  const choose = (choice: NonNullable<typeof question>['choices'][number]): void => {
    if (choice.run) return choice.run()
    answer(q!, choice.choice!, rest)
    setRest(false)
  }
  return (
    <section className="add-panel" aria-label="Adding links">
      <div className="add-head">
        <b>{title}</b>
        {job.running ? (
          <button
            className="icon-btn"
            type="button"
            aria-label="Minimise"
            onClick={() => setSmall(true)}
          >
            –
          </button>
        ) : (
          <button className="icon-btn" type="button" aria-label="Close" onClick={closeJob}>
            ×
          </button>
        )}
        {job.running && (
          <>
            <div className="addprog-bar" style={{ gridColumn: '1 / -1' }}>
              <i style={{ width: `${progress * 100}%` }} />
            </div>
            <span className="muted add-line" role="status">
              {line}
            </span>
          </>
        )}
      </div>
      <ul className="add-list" aria-label="Links">
        {job.items.map((it) => (
          <li key={it.key} className={`add-item s-${it.state}`}>
            <span className="add-dot" aria-hidden />
            <span className="add-url" title={it.link}>
              {it.info?.name ?? it.link}
            </span>
            <span className="add-note" title={it.note}>
              {it.note}
            </span>
          </li>
        ))}
      </ul>
      {q && question && (
        <div className="add-ask" role="group" aria-label={question.title}>
          <div>
            {question.body}
            {waitingCount > 1 && <span className="muted"> ({waitingCount - 1} more waiting)</span>}
          </div>
          <div className="actions">
            {question.choices.map((c) => (
              <button
                key={c.label}
                className={`btn${c.primary ? ' primary' : ''}`}
                type="button"
                onClick={() => choose(c)}
              >
                {c.label}
              </button>
            ))}
          </div>
          {question.rest && (
            <label className="inline" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={rest} onChange={(e) => setRest(e.target.checked)} />
              Do the same for the rest
            </label>
          )}
        </div>
      )}
      {!job.running && (
        <div className="add-done">
          <span>
            {[
              count('joined') ? `${count('joined')} joined others as backup links.` : '',
              count('skipped') ? `Skipped ${count('skipped')}.` : ''
            ]
              .filter(Boolean)
              .join(' ')}{' '}
            {failed.length > 0 && (
              <b>
                {failed.length === 1 ? 'This link' : `${failed.length} links`} couldn’t be added.
              </b>
            )}
          </span>
          {failed.length > 0 && (
            <div className="actions">
              <button className="btn primary" type="button" onClick={retryFailed}>
                Retry
              </button>
              <button
                className="btn"
                type="button"
                onClick={() =>
                  void api
                    .copyText(failed.map((f) => f.link).join('\n'))
                    .then(() =>
                      toast(
                        failed.length === 1
                          ? 'Failed link copied.'
                          : `${failed.length} failed links copied.`
                      )
                    )
                    .catch(report)
                }
              >
                {failed.length === 1 ? 'Copy failed link' : 'Copy failed links'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
