---
slug: equipo-4-subagentes-ventas
category: agentes
title: Arma un equipo de ventas de 4 subagentes en Claude Code
summary: Investigador, calificador, redactor y seguimiento: 4 subagentes con su configuración lista para copiar y la rutina diaria.
publishedAt: 2026-12-01
promisedBy: []
template: "Calificador de leads (plantilla `lead` del builder): formulario de entrada con puntaje; el orquestador lee las respuestas calificadas por el conector de dForms"
thumbnailMotif: "Una terminal lanza 4 tarjetas (Investigador, Calificador, Redactor, Seguimiento) que trabajan en paralelo y juntan una lista del día con borradores listos."
---
Un buen SDR hace cuatro trabajos distintos cada día: investiga a la cuenta, decide si vale la pena, escribe un primer mensaje que no suene a plantilla y lleva el registro de a quién contactó y cuándo le toca el siguiente toque. Cuando una sola persona (o un solo chat de IA) hace los cuatro, se mezclan: la investigación se queda corta, el mensaje sale genérico y el seguimiento se olvida.

Claude Code te deja separar esos cuatro trabajos en **subagentes**: asistentes especializados, cada uno con sus instrucciones, sus herramientas permitidas y su propia memoria de trabajo. Un orquestador (tu sesión principal) les reparte el trabajo y junta los resultados. Tú revisas y apruebas.

Esta guía te da los 4 roles, la configuración de cada uno lista para copiar y una rutina diaria de 20 minutos. No necesitas saber programar, pero sí sentirte cómodo abriendo una terminal.

## Qué es un subagente, en simple

Un subagente es un archivo de texto con instrucciones que Claude Code carga como un especialista. Vive en la carpeta `.claude/agents/` de tu proyecto (o en `~/.claude/agents/` si lo quieres en todos tus proyectos) y tiene dos partes: un encabezado con su nombre, cuándo usarlo y qué herramientas puede tocar, y debajo sus instrucciones.

Tres cosas lo hacen útil para ventas:

1. **Contexto propio.** Cada subagente trabaja en su propia ventana de contexto. La investigación de 30 cuentas no llena el chat principal, y cada uno se concentra en una sola tarea.
2. **Herramientas limitadas.** El investigador puede buscar en la web, pero no escribir en tu CRM. El redactor puede escribir borradores, pero no navegar. Menos permisos, menos sorpresas.
3. **Se invocan solos o a pedido.** Claude Code usa la descripción del subagente para saber cuándo delegarle. También puedes pedirlo directo: «usa el investigador con esta lista».

Puedes crearlos con el comando `/agents` dentro de Claude Code, o escribiendo el archivo a mano.

<!-- muro -->

## Los 4 roles

| Subagente | Su único trabajo | Herramientas | Entrega |
|---|---|---|---|
| Investigador | Juntar hechos verificables de cada cuenta | Búsqueda y lectura web | Ficha por cuenta con fuentes |
| Calificador | Puntuar cada cuenta contra tu cliente ideal | Solo lectura de archivos | Puntaje, veredicto y por qué |
| Redactor | Escribir el primer mensaje y 2 seguimientos | Lectura y escritura de archivos | Borradores, nunca envíos |
| Seguimiento | Llevar el registro y decir a quién le toca hoy | Lectura y escritura del registro | Lista del día |

La regla que sostiene todo: **ningún subagente envía nada.** Todos dejan borradores en una carpeta. El que manda eres tú.

## El orquestador

El orquestador es tu sesión normal de Claude Code. Dale las reglas del equipo en el archivo `CLAUDE.md` de la carpeta del proyecto:

```
# Equipo de ventas

Cliente ideal: [industria, tamaño, cargo de quien decide, señales de compra].
Descalificadores: [las 3 a 5 cosas que hacen que alguien nunca te compre].

Flujo para cada lista nueva en leads/entrada.csv:
1. investigador: una ficha por cuenta en leads/fichas/.
2. calificador: puntaje y veredicto en leads/calificados.csv.
3. redactor: solo para veredicto AGENDA o NUTRE, borradores en leads/borradores/.
4. seguimiento: actualiza leads/registro.csv y me da la lista de hoy.

Reglas:
- Nadie envía mensajes. Todo queda como borrador para que yo lo revise.
- Si un dato no tiene fuente, se marca "SIN VERIFICAR".
- Corre el investigador en paralelo por lotes de 5 cuentas.
```

## La configuración de los 4, lista para copiar

Crea cada archivo en `.claude/agents/`.

**`investigador.md`**

```
---
name: investigador
description: Investiga cuentas y prospectos antes de contactarlos. Úsalo con cada lista nueva de leads.
tools: WebSearch, WebFetch, Write
---
Eres investigador de ventas B2B. Para cada cuenta, busca en su sitio web, noticias y perfiles públicos de la empresa:
- Qué vende y a quién, en una frase.
- Tamaño aproximado y dónde opera.
- 2 o 3 hechos recientes que sirvan para abrir una conversación (una contratación, un lanzamiento, una publicación).
- Señales de que tiene el problema que resolvemos.
Cada hecho lleva su URL. Si no encuentras algo, escribe "SIN VERIFICAR". Nunca inventes.
Guarda una ficha por cuenta en leads/fichas/<empresa>.md.
```

**`calificador.md`**

```
---
name: calificador
description: Califica cuentas investigadas contra el cliente ideal. Úsalo después del investigador.
tools: Read, Write
---
Lee el cliente ideal y los descalificadores en CLAUDE.md y cada ficha en leads/fichas/.
Puntúa de 0 a 10: encaje (0 a 4), señales del problema (0 a 3), momento (0 a 3).
Un descalificador deja el puntaje en 0.
Veredicto: AGENDA (7 o más), NUTRE (4 a 6), DESCARTA (0 a 3).
Escribe una fila por cuenta en leads/calificados.csv: empresa, puntaje, veredicto y una línea de por qué.
No uses nada que no esté en la ficha.
```

**`redactor.md`**

```
---
name: redactor
description: Escribe borradores de primer contacto y seguimiento para cuentas calificadas.
tools: Read, Write
---
Solo trabajas cuentas con veredicto AGENDA o NUTRE en leads/calificados.csv.
Por cuenta escribe:
1. Primer mensaje de máximo 90 palabras. La primera frase habla de su empresa, usando un hecho de la ficha. Un solo problema. Cierra con una pregunta de sí o no.
2. Seguimiento a los 3 días, máximo 60 palabras, con algo nuevo de valor.
3. Cierre a los 10 días: pregunta si archivas el tema, con humor y sin culpa.
Prohibido: "espero que estés bien", "solo quería dar seguimiento", datos sin fuente.
Guarda todo en leads/borradores/<empresa>.md. Nunca envías nada.
```

**`seguimiento.md`**

```
---
name: seguimiento
description: Mantiene el registro de contactos y arma la lista del día. Úsalo al inicio de cada jornada.
tools: Read, Write
---
Mantienes leads/registro.csv con: empresa, veredicto, último toque, fecha, próximo toque, estado.
Cada mañana:
- Agrega las cuentas nuevas de leads/calificados.csv.
- Lista a quién le toca hoy, en orden de puntaje.
- Marca como "frío" a quien lleva 3 toques sin respuesta.
- Nunca borras filas, solo cambias el estado.
```

## Tu rutina diaria

1. **Mañana, 5 minutos.** Pega la lista nueva en `leads/entrada.csv` y escribe: «Corre el flujo con la lista nueva».
2. **10 minutos.** Revisa `leads/calificados.csv`. Si un veredicto no te convence, corrige a mano: es la mejor señal para afinar el cliente ideal en `CLAUDE.md`.
3. **5 minutos.** Abre los borradores de AGENDA, edita lo que suene raro y envía tú desde tu correo o LinkedIn.
4. **Fin del día.** Dile al orquestador qué enviaste y quién respondió: «Actualiza el registro: envié a estas 6, respondieron 2». El subagente de seguimiento lo anota.

## Costos, trampas y cuándo no hacerlo

- **Cada subagente gasta tokens.** Correr 4 especialistas por cuenta cuesta más que un solo chat. Empieza con lotes chicos y mira tu consumo antes de pasar a 50 cuentas al día.
- **La investigación puede inventar.** Por eso la regla de URL por hecho y el «SIN VERIFICAR». Revisa las fuentes de las cuentas AGENDA antes de escribirles.
- **No automatices el envío.** Un mensaje equivocado a un buen prospecto cuesta más que el tiempo que ahorras. El equipo prepara; tú decides.
- **Respeta las reglas de cada plataforma.** No uses al investigador para extraer datos de sitios que lo prohíben.
- **Cuándo no vale la pena:** si te llegan menos de 10 leads a la semana o todavía no tienes claro tu cliente ideal. Primero escribe el cliente ideal; el equipo solo multiplica lo que ya sabes.

## Hazlo con dForms

La mejor lista para tu equipo no es una base comprada: son las personas que llenaron tu formulario, con sus respuestas y su puntaje. Conecta las dos cosas.

**El form: «Solicitud de demo»** (plantilla Calificador de leads).

1. **Formularios → Crear formulario**, diseño **Diapositivas**, plantilla **Calificador de leads**. Agrega empresa y sitio web, y deja 3 o 4 preguntas con puntos (tamaño, urgencia, rol).
2. **Lógica → Puntaje** y **Lógica → Resultados:** crea los mismos tres veredictos que usa tu calificador (AGENDA, NUTRE, DESCARTA), con sus mensajes finales. Así el formulario y el subagente hablan el mismo idioma.
3. **Publica** y pon el link en tu web y tu firma.
4. Conecta dForms a Claude Code: en app.dforms.ai abre **Conecta tu agente** y copia la URL del conector. En la terminal corre `claude mcp add --transport http dforms <URL del conector>` y luego `/mcp` dentro de Claude Code para iniciar sesión.
5. Agrega este paso cero a tu `CLAUDE.md`: «Antes de leer leads/entrada.csv, usa dForms para traer las respuestas de ayer del formulario Solicitud de demo con resultado AGENDA o NUTRE y agrégalas a la lista, con su sitio web y sus respuestas».

Desde ese día, el investigador arranca con cuentas que ya levantaron la mano, y el redactor abre cada mensaje con lo que la persona contestó.
