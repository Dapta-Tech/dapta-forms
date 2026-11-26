---
slug: prompts-prohibidos-vender-con-ia
category: ventas
title: Los prompts prohibidos para vender con IA
summary: 12 prompts en 3 niveles para los 4 momentos que deciden una venta: primer contacto, seguimiento, no-show y precio.
publishedAt: 2026-11-26
promisedBy: []
template: "Calificador de leads (plantilla `lead` del builder), adaptado: «Filtro antes de agendar» con presupuesto, quién decide y urgencia; agenda solo si califica"
thumbnailMotif: "Un chat recibe un prompt pegado, la respuesta se escribe sola y una etiqueta sube de $2K a $6K a $10K con un candado que se abre."
thumbnailVideo: /playbooks/prompts-prohibidos-vender-con-ia.webm
thumbnailPoster: /playbooks/prompts-prohibidos-vender-con-ia-poster.webp
---
Les decimos prohibidos porque se sienten como hacer trampa: cada prompt de esta guía hace en dos minutos algo que a un vendedor le toma una tarde. Están ordenados por los cuatro momentos que deciden una venta: el primer contacto, el seguimiento, el no-show y la objeción de precio.

<!-- img: prompts-prohibidos-vender-con-ia/cuatro-momentos | Línea de una venta con sus cuatro momentos: primer contacto, seguimiento, no-show y precio, con los prompts de cada nivel debajo -->

Y vienen en 3 niveles, los de tres vendedores distintos:

| Nivel | Qué hace con la IA | Prompts |
|---|---|---|
| $2K | Copia y pega en ChatGPT o Claude, mensaje por mensaje | 02, 04, 06, 08 |
| $6K | Usa la IA para armar sistemas: propuestas, secuencias, práctica | 03, 05, 07, 09 |
| $10K | Arma un filtro que trabaja mientras vende | 12 y el paso final |

Empieza por tu nivel y sube. Funcionan en ChatGPT, Claude o Gemini, y lo que está entre [corchetes] lo cambias por tus datos. El truco que casi nadie usa: pegar primero tu ficha de ventas.

## Paso cero: tu ficha de ventas

La razón número uno por la que la IA escribe genérico es que no sabe nada de tu negocio. Llena esta ficha una sola vez, guárdala en tus notas y pégala al inicio de cada chat.

<!-- anim: prompts-prohibidos-vender-con-ia/con-ficha-y-sin-ficha | El mismo pedido en un chat sin ficha da un mensaje genérico; al pegar primero la ficha de ventas, la IA escribe un mensaje que habla de la empresa del prospecto -->

**Prompt 01 · Ficha de ventas.** Úsalo al inicio de cada chat.

```
ROL: Eres mi asistente de ventas. Usa esta ficha en todo lo que escribas en este chat.
MI NEGOCIO
- Qué vendo: [en una frase]
- Cliente ideal: [industria, tamaño y cargo de quien decide]
- Problema que resuelvo: [el dolor, con las palabras de mis clientes]
- Resultado que entrego: [un caso real con número]
- Rango de precio: [desde / hasta]
- Objeciones comunes: [las 3 que más escucho]
- Si no me compran: [qué hacen hoy, aunque sea "nada" o "Excel"]
- Tono: [cercano o formal], español de [país], de tú.
REGLAS
- Frases cortas. Nada de palabras de marketing.
- Nunca inventes datos, casos ni clientes.
- Si te falta información, pregúntame antes de escribir.
PARA EMPEZAR: responde solo "Listo" y espera mi primera instrucción.
```

Por qué funciona: las líneas de «nunca inventes» y «pregúntame antes» son las que más cambian el resultado. Sin ellas, la IA rellena con supuestos.

<!-- muro -->

## Momento 1: el primer contacto

**$2K · Prompt 02 · El correo que sí se lee.** Antes de escribirle a alguien nuevo. Te da 2 correos y 3 asuntos.

```
CONTEXTO: Voy a escribirle por primera vez a [nombre], [cargo] en [empresa].
Lo que sé de su empresa: [un dato real: una contratación, una publicación, una reseña].
TAREA: Escribe un correo para conseguir una llamada de 15 minutos.
REGLAS: máximo 90 palabras. La primera frase habla de su empresa, no de la mía.
Un solo problema y un solo resultado. Cierra con una pregunta de sí o no, sin link de calendario.
ENTREGA: 2 versiones (una directa, una que despierte curiosidad) y 3 asuntos de máximo 5 palabras, en minúscula.
```

**$6K · Prompt 03 · Propuesta y objeciones.** Justo después de la llamada de descubrimiento.

```
CONTEXTO: Mis notas de la llamada con [empresa]: [pega tus notas o la transcripción].
TAREA:
1. Resume el problema del cliente en 3 líneas, con sus palabras.
2. Arma una propuesta de 1 página: situación actual, qué proponemos, resultado esperado, inversión y siguiente paso con fecha.
3. Lista las 5 objeciones más probables. Para cada una: la frase de la llamada que la delata y una respuesta de máximo 2 frases.
4. Dime qué me faltó preguntar y cómo preguntarlo.
REGLA: si un número no está en mis notas, escribe "POR COMPLETAR". No lo inventes.
```

## Momento 2: el seguimiento

**$2K · Prompt 04 · Seguimiento después de la reunión.** El día siguiente.

```
CONTEXTO: Ayer me reuní con [nombre] de [empresa]. Hablamos de [tema] y quedó pendiente [qué].
TAREA: Escribe un mensaje de seguimiento para [WhatsApp / correo].
REGLAS: máximo 60 palabras. Abre con algo específico que dijo en la reunión.
Suma una sola cosa nueva de valor: [un dato, un caso o un recurso].
Cierra con una pregunta concreta con fecha.
Prohibido: "solo quería dar seguimiento", "espero que estés bien" y "quedo atento".
```

**$6K · Prompt 05 · Secuencia de 6 toques en 14 días.** Cuando un lead se enfría.

```
CONTEXTO: Lead que [no respondió después de la propuesta / pidió información y desapareció].
Canales que uso: [correo, WhatsApp, llamada, LinkedIn].
TAREA: Diseña una secuencia de 6 toques en 14 días.
REGLAS: cada toque aporta algo nuevo (un caso, una pregunta, un dato o un recurso).
Alterna canales, nunca dos correos seguidos. WhatsApp: máximo 40 palabras.
El toque 6 es de cierre: pregunta si archivo el tema, con humor y sin culpa.
ENTREGA: por toque, día, canal, objetivo y mensaje listo. Al final, una tabla para mi CRM.
```

El toque 6, el de «¿lo archivo?», suele traer respuestas: a nadie le gusta cerrar una puerta.

## Momento 3: el no-show

**$2K · Prompt 06 · Reagendar sin reclamo.** El mismo día.

```
CONTEXTO: [Nombre] no llegó a nuestra reunión de hoy a las [hora].
TAREA: Escribe un WhatsApp para reagendar.
REGLAS: máximo 35 palabras. Cero reclamo y cero culpa: asume que se le complicó el día.
Ofrece 2 horarios: [opción 1] y [opción 2]. Cierra con "¿te sirve la 1 o la 2?".
ENTREGA: 3 versiones: cálida, directa y con humor.
```

**$6K · Prompt 07 · Cadena anti no-show.** Al agendar cualquier reunión.

```
CONTEXTO: Reunión de [tipo], agendada con [X] días de anticipación.
TAREA: Escribe los recordatorios:
1. Al agendar: qué va a pasar y qué debe tener a mano.
2. 24 horas antes: una pregunta que pida respuesta, como "¿sigue en pie?".
3. 2 horas antes: recordatorio corto con el link.
4. 5 minutos tarde: el link otra vez, en una línea.
5. Si no llegó: reagenda con 2 horarios nuevos.
6. 48 horas sin respuesta: un último mensaje para cerrar el ciclo.
ENTREGA: por mensaje, canal, momento y texto. WhatsApp: máximo 40 palabras.
```

El recordatorio de 24 horas pide una respuesta. Quien contesta «sí» se compromete, y quien no contesta te avisa con tiempo que hay riesgo.

<!-- anim: prompts-prohibidos-vender-con-ia/cadena-anti-no-show | Una línea de tiempo desde que agendas hasta la reunión muestra los recordatorios de la cadena anti no-show y cómo el de 24 horas pide una respuesta que compromete -->

## Momento 4: «está muy caro»

**$2K · Prompt 08 · Leer la objeción.** Cuando te dicen que está caro.

```
CONTEXTO: Un prospecto me dijo: "[la objeción tal cual]".
Vendo [producto] a [tipo de cliente] por [precio]. Ya le mostré [qué vio].
TAREA:
1. Qué puede estar diciendo de verdad: 3 lecturas posibles.
2. Una pregunta para descubrir cuál de las 3 es.
3. Una respuesta por lectura, de máximo 3 frases.
4. Qué NO debo decirle.
REGLA: ninguna respuesta baja el precio.
```

**$6K · Prompt 09 · Roleplay con cliente difícil.** Antes de una llamada importante. Usa el modo de voz: practicar hablando se parece más a la llamada real.

```
TU PAPEL: Eres [cargo] de [tipo de empresa] y te parece caro. Objeción principal: [objeción].
Tienes 2 objeciones escondidas que solo sacas si pregunto bien: [objeción 2] y [objeción 3].
REGLAS: responde corto, a veces seco. Solo cedes si hago buenas preguntas y conecto el precio con tu problema.
EVALUACIÓN: tras 8 intercambios, o si escribo "pausa", sal del personaje. Califícame del 1 al 10 en descubrimiento, manejo de la objeción y cierre. Cita la frase exacta donde me equivoqué y cómo la diría un vendedor top.
PARA EMPEZAR: abre tú, diciendo la objeción.
```

## Bonus: antes y después de la llamada

**Prompt 10 · Prepárame para la llamada.** 10 minutos antes.

```
En [X] minutos tengo llamada con [nombre], [cargo] en [empresa]. Esto sé: [su web, su LinkedIn o mis notas].
En una sola pantalla: 3 datos de su empresa que debo mencionar, 5 preguntas de descubrimiento de la más fácil a la más profunda, la objeción más probable con su respuesta y un buen siguiente paso para pedir al final.
```

**Prompt 11 · Autopsia del trato perdido.** Cada vez que pierdes uno.

```
Esta es toda la conversación con [cliente], que no cerró: [pega correos, chats o transcripción].
Sé directo, no me consueles. 1. ¿En qué momento exacto se perdió? Cita la frase. 2. ¿Qué señal ignoré? 3. Tres cosas que haría distinto, por impacto. 4. ¿Vale un último intento? Si sí, escríbeme el mensaje.
```

Hazlo hábito: en un mes vas a ver el mismo error repetido, y ese es el que más dinero te cuesta.

## Nivel $10K: que el filtro trabaje sin ti

Los niveles $2K y $6K te hacen más rápido, pero todavía dependen de ti. Lo que separa al $10K es que parte del trabajo pasa sin él. La mejor forma de manejar la objeción de precio es no llegar a la reunión con alguien que no puede pagar. Para eso, confirma presupuesto, quién decide y urgencia antes de agendar.

<!-- anim: prompts-prohibidos-vender-con-ia/filtro-antes-de-agendar | Tres leads contestan presupuesto, quién decide y urgencia; sus puntos se suman y solo el que pasa el corte ve tu calendario, los demás reciben un recurso gratis -->

**$10K · Prompt 12 · Diseña tu filtro.** Pégalo después de tu ficha.

```
Con mi ficha de ventas, diseña 3 preguntas de opción múltiple para confirmar antes de agendar: presupuesto, quién decide y urgencia.
Para cada opción, dame un puntaje (positivo, cero o negativo) y dime desde qué puntaje vale la pena una reunión.
Las preguntas deben sonar naturales, nunca a interrogatorio.
```

## Hazlo con dForms

Convierte el resultado del prompt 12 en un formulario que filtra solo, y deja tu link de agenda detrás de él.

**El form: «Filtro antes de agendar»** (parte de la plantilla Calificador de leads).

1. En **Formularios → Crear formulario**, elige **Diapositivas** y la plantilla **Calificador de leads**. Cambia las preguntas por las 3 del prompt 12 y suma nombre, correo y WhatsApp al final.
2. En **Lógica → Puntaje** activa el puntaje y copia los puntos que te dio la IA.
3. En **Lógica → Resultados** crea dos rangos: «No califica» (le agradeces y le dejas un recurso gratis o tu plan menor) y «Califica».
4. Agrega un **Agendador** con tu Calendly y en **Editar lógica** ponle «Mostrar cuando Puntaje hasta aquí es mayor que» tu corte. Quien no llega al corte nunca ve tu calendario.
5. En **Conectar → Integraciones** manda cada respuesta a HubSpot con su puntaje, o a un webhook para avisarle a tu equipo.
6. Publica y reemplaza tu link de calendario por el del formulario en tu firma, tu bio y tus correos.

Ahora el prompt 10 trabaja mejor: llegas a cada llamada con presupuesto, decisor y urgencia ya respondidos.
