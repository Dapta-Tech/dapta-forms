---
slug: calificador-claude
category: agentes
title: Cómo Claude califica tus leads solo
summary: 4 prompts para que Claude diseñe tu cliente ideal, 7 preguntas que califican, el puntaje y los finales AGENDA, NUTRE y DESCARTA.
publishedAt: 2026-11-26
promisedBy: []
template: "Calificador de leads (plantilla `lead` del builder): calificador de hasta 7 preguntas con 3 resultados (AGENDA con Agendador, NUTRE, DESCARTA), armado con la salida de los 4 prompts"
thumbnailMotif: "Claude escribe 4 prompts uno tras otro; los leads entran al formulario y salen ordenados en tres carriles: AGENDA, NUTRE y DESCARTA."
thumbnailVideo: /playbooks/calificador-claude.webm
thumbnailPoster: /playbooks/calificador-claude-poster.webp
---
Claude ya puede hacer el trabajo que antes solo hacía tu mejor vendedor: mirar un prospecto y saber, en segundos, si vale la pena. Quién es tu cliente ideal, qué preguntas lo delatan, cuánto pesa cada respuesta. Todo eso lo puede diseñar por ti, hoy.

Y casi todos lo van a usar mal. La mayoría usa la IA para escribir más posts y más correos: más volumen de lo mismo. Mientras tanto, sus leads siguen entrando por un formulario genérico (nombre, correo, «cuéntanos más») y su equipo sigue agendando reuniones con curiosos que no van a comprar.

El desperdicio real no está en atraer, está en filtrar. Cada lead que no califica igual ocupa una llamada, un espacio en la agenda y la energía del equipo. El mejor uso de Claude en ventas no es escribir más contenido: es diseñar el filtro. Las preguntas exactas, el puntaje de cada respuesta y la línea que separa al lead que compra del que solo quería el PDF.

## Por qué un formulario diseñado por IA cambia el juego

Un formulario genérico le hace las mismas preguntas al director con presupuesto y al estudiante haciendo tarea. Los dos llegan a tu CRM con el mismo peso, y tu equipo pierde horas descubriendo en llamada lo que 4 preguntas bien hechas habrían revelado gratis.

Las preguntas correctas hacen el trabajo del SDR. Un lead que responde «tengo presupuesto aprobado y lo necesito este trimestre» no necesita una llamada de descubrimiento: necesita un link de agenda. Uno que responde «solo estoy explorando» no necesita una llamada: necesita contenido, y que no le quite tiempo a nadie. La diferencia entre los dos son 3 o 4 preguntas. Las correctas.

El problema nunca fue hacer preguntas, fue saber cuáles. Ahí entra Claude: lee tu negocio y deduce tu cliente ideal, escribe las preguntas que separan compradores de curiosos, le pone puntaje a cada respuesta y define el umbral para agendar.

<!-- muro -->

## Qué hace el sistema de punta a punta

1. **El lead entra al formulario,** desde tu LinkedIn, tu web, un QR o donde sea.
2. **Responde las preguntas que Claude diseñó.** Pocas, directas, y cada una revela algo: presupuesto, urgencia, tamaño o autoridad.
3. **Cada respuesta suma o resta puntos.** El puntaje corre mientras avanza; él nunca lo ve.
4. **El formulario decide solo:** puntaje alto, le muestra tu calendario y agenda ahí mismo; medio, lo manda a tu nutrición; bajo, le agradece con elegancia y no le quita tiempo a nadie.
5. **Todo cae a tu CRM con su puntaje.** El lunes la lista ya está ordenada: quién es reunión, quién es correo y quién es nada.

Esto reemplaza al SDR revisando leads uno por uno, las llamadas con gente que nunca iba a comprar y el «déjame ver si califica» de 3 días que enfría al lead bueno.

## Los 4 prompts

Abre Claude, pega el prompt, reemplaza lo que está entre corchetes y córrelo. Córrelos en orden y en el mismo chat, para que Claude mantenga el contexto. Para el primero, activa la búsqueda web para que lea tu sitio real.

**Prompt 1 · Define a quién calificar.**

```
Eres un estratega de go-to-market B2B. Construye el perfil de cliente ideal (ICP) del negocio detrás del sitio web que te doy al final, con un solo objetivo: calificar leads que llegan por un formulario.

REGLAS:
- Usa búsqueda web. Abre el sitio de verdad: home, producto, precios, casos. No inventes.
- La especificidad vale más que el largo. Nunca escribas "empresas B2B" si puedes escribir "agencias de marketing de 5 a 30 personas que venden retainers".
- Si algo no está claro, busca la empresa por nombre y llena los vacíos.

Devuelve EXACTAMENTE:
## 1. Qué vende este negocio: la oferta en una frase sin marketing, el resultado que compra el cliente, rango de precio si se puede inferir.
## 2. El cliente ideal: industria específica, tamaño, el comprador exacto (cargo y área), sus 3 dolores más profundos y el disparador (por qué compra AHORA y no en 6 meses).
## 3. Las señales: las 6 a 10 que, preguntadas en un formulario, revelan si un lead es comprador real. Para cada una, qué revela y por qué predice compra. De mayor a menor poder.
## 4. Los descalificadores: las 3 a 5 respuestas que indican que un lead NO va a comprar.

Sin introducción ni cierre. Este es el sitio: [URL DE TU SITIO]
```

**Prompt 2 · Escribe las preguntas que califican.**

```
Eres un diseñador de formularios de calificación B2B. Con el ICP de arriba, diseña las preguntas exactas de un formulario que separa compradores de curiosos.

REGLAS:
- Máximo 7 preguntas. Si una no cambia el puntaje, se elimina.
- Todas de opción múltiple o escala. El texto abierto no se puede puntuar.
- Que suenen naturales: "¿Cuándo te gustaría resolver esto?", no "Indique su horizonte temporal de compra".
- Cubre presupuesto, urgencia, autoridad y encaje. Si el ICP sugiere otra dimensión más predictiva, úsala y dime por qué.
- De menor a mayor fricción: la de presupuesto nunca de primera.

Por cada pregunta: el texto listo para copiar, las opciones listas para copiar y qué mide cada opción. Al final, el orden completo con una línea de por qué. Sin introducción ni cierre.
```

**Prompt 3 · Asigna el puntaje y los umbrales.**

```
Eres un RevOps senior. Convierte las preguntas de arriba en un sistema de puntaje para un formulario que decide solo.

REGLAS:
- Puntos a CADA opción de CADA pregunta: positivos, cero o negativos.
- Las señales fuertes pesan más que las débiles.
- Un descalificador duro debe hundir el total por sí solo.
- Calcula el mínimo y el máximo posible.

Devuelve: la tabla de puntos (pregunta, opción, puntos, una línea de por qué), el rango total y 3 umbrales:
- AGENDA (de X hacia arriba): va directo al calendario
- NUTRE (entre X y Y): recibe contenido, no llamada
- DESCARTA (menos de Y): agradece y termina
Cierra con una prueba de fuego: simula 3 leads (uno que compra, uno tibio, uno curioso), muestra su puntaje y verifica que cada uno cae donde debe. Si alguno cae mal, corrige la tabla y muestra la versión final.
```

**Prompt 4 · Escribe los finales.** Cada umbral necesita su pantalla final, y es la parte que casi todos arruinan.

```
Eres un copywriter de conversión. Escribe las 3 pantallas finales del formulario de arriba, una por umbral.

REGLAS:
- AGENDA: celebra sin exagerar y lleva al calendario ya. El lead caliente se enfría en horas.
- NUTRE: honesto y generoso. Recibe algo de valor hoy, sin promesa falsa de llamada.
- DESCARTA: elegante. Jamás debe sentirse rechazado. Agradece, deja un recurso y cierra bien. Este copy protege tu marca.
- Máximo 40 palabras por pantalla. Humano y directo, sin "¡Felicidades!".

Devuelve solo: Pantalla AGENDA, Pantalla NUTRE, Pantalla DESCARTA.
```

## Antes de publicarlo

- **Revisa los descalificadores a mano.** Claude deduce; tú sabes quién no te compra nunca.
- **Prueba los 3 caminos** con los 3 leads simulados del prompt 3 antes de mandar tráfico.
- **Ajusta con datos reales.** Después de las primeras 50 respuestas, compara puntaje contra quién cerró y mueve los cortes.

## Hazlo con dForms

Ya tienes las preguntas, el puntaje, los umbrales y el copy. Falta pegarlos en un formulario que sepa puntuar, ramificar y agendar, para no correr esto a mano lead por lead.

**El form: «Calificador»** (plantilla Calificador de leads).

1. **Formularios → Crear formulario**, diseño **Diapositivas**, plantilla **Calificador de leads**. Reemplaza sus preguntas por las del prompt 2, en el mismo orden, y agrega nombre y correo al final.
2. **Lógica → Puntaje:** activa el puntaje y copia la tabla del prompt 3, opción por opción. Revisa que el máximo posible coincida con el que calculó Claude.
3. **Lógica → Resultados:** crea tres rangos con las etiquetas AGENDA, NUTRE y DESCARTA y los límites del prompt 3. Pega en cada uno la pantalla del prompt 4.
4. Agrega un **Agendador** después de la última pregunta con puntos, conecta Calendly y en **Editar lógica** ponle «Mostrar cuando Puntaje hasta aquí es mayor que» el inicio de AGENDA menos uno.
5. En **Conectar → Integraciones** manda cada lead a HubSpot con su puntaje y su resultado, o a un webhook que lo meta en tu secuencia de nutrición si cae en NUTRE.
6. **Publica**, prueba los 3 leads simulados y pon el link donde hoy tienes tu «Contáctanos».

**Atajo con el conector:** si conectas dForms a Claude (en app.dforms.ai, **Conecta tu agente**), al terminar el prompt 4 escribe en el mismo chat: «Usa dForms para crear este formulario con las preguntas, los puntos, los 3 resultados y sus pantallas, y dame el link». Claude lo arma y lo publica sin que copies nada.
