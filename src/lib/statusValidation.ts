type StatusNameItem = {
  id: string
  name: string
}

type StatusNameValidation =
  | { ok: true; value: string }
  | { ok: false; message: string }

export function validateStatusName(name: string, statuses: StatusNameItem[], currentId?: string): StatusNameValidation {
  const value = name.trim()

  if (!value) {
    return { ok: false, message: '状态名不能为空' }
  }

  const exists = statuses.some(status => status.id !== currentId && status.name.trim() === value)
  if (exists) {
    return { ok: false, message: '状态名已存在' }
  }

  return { ok: true, value }
}
