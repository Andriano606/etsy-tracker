import { useStore } from '../store'
import { useEscape } from './useEscape'

// In-app confirmation dialog (a native confirm() leaves the window unfocused on Linux).
export function ConfirmModal(): JSX.Element | null {
  const { confirmRequest, resolveConfirm } = useStore()
  useEscape(() => resolveConfirm(false), confirmRequest != null)
  if (!confirmRequest) return null

  return (
    <div className="modal-backdrop" onClick={() => resolveConfirm(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 420 }}>
        <h2>Підтвердження</h2>
        <div className="hint" style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>
          {confirmRequest.message}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => resolveConfirm(false)}>
            Скасувати
          </button>
          <button className="btn danger" autoFocus onClick={() => resolveConfirm(true)}>
            Підтвердити
          </button>
        </div>
      </div>
    </div>
  )
}
