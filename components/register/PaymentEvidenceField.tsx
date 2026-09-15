type Props = { value: string; onChange: (value: string) => void };

export function PaymentEvidenceField({ value, onChange }: Props) {
  return (
    <label className="mb-3 block text-sm">
      Терминал / шилжүүлгийн баримтын дугаар
      <input
        className="mt-2 block min-h-11 w-full border border-[#8c8c8c] p-2"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={500}
        placeholder="Баримтын дугаар, төлбөрийн дүн"
        autoComplete="off"
      />
      <span className="mt-2 block text-xs text-[#666]">
        Ажилтны бүртгэл. Банкны орлоготой автоматаар тулгаагүй.
        Олон төлбөр байвал дүн бүрийн баримтыг бичнэ үү.
      </span>
    </label>
  );
}
