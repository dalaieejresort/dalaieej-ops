import styles from "./Pos.module.css";

export function OrderServiceFields({ serviceTable, preparationNotes, onTableChange, onNotesChange }: {
  serviceTable: string;
  preparationNotes: string;
  onTableChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}) {
  return <fieldset className={styles.serviceFields}>
    <legend>Үйлчлэх газар · гал тогооны тайлбар</legend>
    <label>Рестораны ширээ
      <input aria-label="Рестораны ширээ" inputMode="numeric" value={serviceTable} maxLength={80}
        placeholder="Жишээ: 12" onChange={event => onTableChange(event.target.value)} />
    </label>
    <p>Байшин / зочны дансыг доор тусад нь сонгоно.</p>
    <label>Гал тогоонд өгөх тайлбар
      <textarea value={preparationNotes} maxLength={1000} rows={2}
        placeholder="Жишээ: шөлөнд сонгино хийхгүй" onChange={event => onNotesChange(event.target.value)} />
    </label>
  </fieldset>;
}
