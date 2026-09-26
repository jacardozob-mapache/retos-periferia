## 1. Problema en una frase

**Desde el 30 de mayo de 2026 Periferia no sabe con certeza qué contratos tiene vigentes, cuáles vencen ni qué pólizas faltan: el maestro dependía de una sola persona que se fue, no hay un punto único de recepción y a administración solo llegan los contratos que exigen póliza.**

### A quién le duele

| Quién | Cómo le duele hoy | Qué cambia con la solución |
|---|---|---|
| **Analista administrativa** (dueña del maestro) | Recibe contratos sueltos, por personas distintas y solo si hay póliza. No puede garantizar que el maestro esté completo ni reconstruir lo que falta. | Un buzón único, un agente que extrae, clasifica y registra, y una cola de revisión solo para los campos dudosos. |
| **Gerencia** (general, comercial y financiera) | No puede responder "¿qué contratos vencen este trimestre?" ni "¿qué pólizas exigidas no se han constituido?". | Reporte de alertas con vencimientos a ≤ 60 días, pólizas no vigentes y contratos registrados desde el corte. |
| **Área financiera** | Factura contratos que no existen en el maestro y no tiene cómo cruzar vigencia contra facturación. | Indicador mensual de cobertura (facturado vs. registrado) y maestro confiable como base del cruce. |
| **Comerciales** | Reciben solicitudes ad hoc y reenvían documentos ya enviados (como el reenvío de msg-004). | Una sola obligación clara (enviar al buzón con un asunto fijo) y un acuse que confirma qué quedó registrado. |
| **Periferia como contratista** | Riesgo contractual: una póliza de cumplimiento exigida que no se constituye o no se amplía tras un otrosí es un incumplimiento frente al cliente. | Toda póliza nueva o ampliada entra como `pendiente` y aparece en alertas hasta que alguien la marque `vigente`. |

### Por qué es un problema de proceso y no solo de automatización

El buzón de prueba lo muestra: de los cuatro documentos registrables, el contrato de Corporación Andina (msg-002, sin póliza) **nunca habría llegado** a administración con la regla actual, y el contrato marco de Distribuidora Caribe (msg-006) lo envía un practicante que ni siquiera está en la lista de comerciales. Un agente solo registra lo que le llega. Por eso la solución tiene dos piezas que no funcionan por separado:

1. **El agente** (este repositorio): punto único de recepción que convierte correos en filas del maestro sin duplicar, sin inventar valores y con confirmación humana para lo dudoso.
2. **La regla de gobierno** (sección 6): qué se envía, a dónde, en qué plazo, qué pasa si no se cumple y cómo se mide que el proceso sigue vivo cuando cambie la persona que lo opera.
