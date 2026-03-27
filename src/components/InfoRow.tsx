import { Pill } from './Pill'

type InfoRowProps = {
  label: string
  value: string
  labelClassName?: string
  valueClassName?: string
}

export function InfoRow({
  label,
  value,
  labelClassName = '',
  valueClassName = '',
}: InfoRowProps) {
  return (
    <div className="info-row">
      <Pill className={labelClassName}>{label}</Pill>
      <Pill className={valueClassName}>{value}</Pill>
    </div>
  )
}
