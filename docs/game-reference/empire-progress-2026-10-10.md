# MafiaBattle — Wiki y progreso de los imperios I y II

Consulta del 10 de octubre de 2026, cuenta **mati792**, nivel195. Objetivo: sostener recursos y conseguir diamantes gratuitos. Lectura del DOM de la sesión propia; no se ejecutaron mejoras, retiros bancarios ni compras reales durante la investigación. Política de salud actual: **vida≤100 → al menos400**, máximo real453, packs cash50/10, reserva100000 y presupuesto400000 por ciclo.

## Evidencia y alcance

Imperio I confirmado por edificios del mapa y títulos de diálogos principales. Imperio II leído desde los diálogos principales precargados por el juego: se indican los niveles que muestra la sesión, sin afirmar una visita física a ese mapa ni los requisitos para desbloquear sus edificios nivel0. Se excluyeron plantillas `*_claim`, subdiálogos y perfiles ajenos. Valores de almacén/vida/saldo cambian mientras el bot trabaja; las cifras son instantáneas, no balances garantizados. Datos estructurados: `empire-progress-2026-10-10.json`.

La portada española dio un bucle de redirecciones; se investigaron páginas individuales accesibles por búsqueda/caché. La wiki contiene valores base y puede quedar atrasada. Se contrastaron con controles y valores reales, que tienen prioridad.

## Imperio I

| Edificio | Nivel observado | Comparación útil |
|---|---:|---|
| Mansión de la Mafia |22|557/600 tropas; siguiente23 exige Acero16 en el DOM. |
| Hospital |19|Máximo453; regeneración1 cada30s; curación≤100→400 activa. |
| Laboratorio de cristal |20|Capacidad350KG, tanda60KG/2h; receta semanal debe verificarse. |
| Fábrica de munición |20|Capacidad5000. Inicio de producción sigue deshabilitado por preferencia previa. |
| Prensa de monedas |19|Capacidad4M; producción real114000/h, frente a76000/h base de la wiki (+50%). |
| Banco |17|13M/13M; wiki base6.5M y research hasta+100%, compatible. |
| Galería de autos |20|21/250 autos; ofertas cada5min. |
| Mansión de jefes |10|3/58 jefes; subir11 requiere Acero12 según wiki, aún pendiente contrastar control. |
| Casa de empeño |10|Venta de recursos disponible; no vender inventario de mejoras sin conocer necesidad. |
| Fábrica de gemas |19|Capacidad4.4M; real108000/h vs72000/h base (+50%). Factory se revisa cada3h. |
| Granja de weed |10|Capacidad1000KG,12 parcelas,50 policías; Perfect weed49k/40KG/6h. |
| Zona roja |12|Diálogo muestra0/6 trabajadoras: oportunidad de ingresos pendiente validar contratación. |
| Club nocturno |11|Stock46978/47000 en última lectura; reposición configurada cada2h. |
| Laboratorio de investigación |21|102/105 investigaciones completadas;14RP disponibles;3 investigaciones en marcha. |
| Laboratorio de armas |19|Reciclaje3h; no consumir armas automáticamente sin política de selección. |
| Tatuajes |20|Stock cercano a60000/62000; reposición cada2h. |
| Punto de encuentro |5|Subir6 exige20M de poder; lectura actual13.45M. |
| Fábrica de cigarros |9|180/275 cigarros; oferta cada3h. |
| Lotería |10|500/500 boletos ya comprados; no agregar apuestas para obtener recursos garantizados. |
| Gimnasio |10|Sesiones7/10; automatización respeta plazas/timer. |

Weed estaba casi llena:999.66/1000KG. Una cosecha de40KG no cabe todavía; vender una oferta libera espacio. El diálogo principal marcaba11/12plantas y el subdiálogo Farm12/12: no se concluye que exista una parcela vacía sin inspeccionar sus controles reales. El bot ya verifica esos controles antes de plantar.

La tabla publicada de weed termina en10: coincide con tu nivel, pero eso no prueba un límite actual si el juego cambia. La colección de todas las gemas puede entregar500diamantes; todas las gemas salen aleatoriamente en cualquier nivel, por lo que mejorar no garantiza una gema rara. [Weed](https://es.mafiabattle.info/weed-farm), [Gemas](https://es.mafiabattle.info/gemstones-factory).

## Imperio II

| Edificio / ID real | Nivel mostrado | Estado y comparación |
|---|---:|---|
| Destilería `alcoholfactory` |10|4900/4900L;400L/h; tanque lleno. |
| Banco suizo `swissbank` |10|5M/6M; el juego indica3% de comisión en transacciones. |
| Bar `mafiabar` |10|Mejora en marcha,≈6d4h restantes; vende320L/h a75cash/L. Wiki11=400L/h. |
| Chatarra `scrapyard` |4|≈142k/570k;17500cash/h. Reciclar autos puede reducir puntuación de torneos según el juego. |
| Almacén `warehouse` |4|Mejora en marcha,≈2d20h; caja cada51h, nivel5 cada48h según wiki. |
| XTC `xtclab` |17|164.2/190KG; producción50/70KG,5h. |
| Transporte `transportcompany` |9|Viaje10h; ofertas/entregas son una vía de diamantes, aún sin automatización verificada. |
| Diamantes `diamondfactory` |5|9315 acumulados;0.79/h≈19/día; retiro exige€4.99 y reinicia stock a100. |
| Barcos `boatcompany` |6|0/22 barcos,17 ofertas; nuevas ofertas15min. |
| Bóveda `mexicanvault` |6|854432759cash; capacidad nominal10M y seguridad16/16. Se permite saldo sobre capacidad; no se trató como cash disponible ni se retiró. |
| Acero `steelfactory` |0|Diálogo principal nivel0, no `steelmill`. Prerrequisito de Mansión23: nivel16. |
| Heroína `heroinlab` |0|Diálogo principal sin capacidad activa. |
| Moto Club `motoclub` |0|Diálogo principal sin motos. |
| Petróleo `oilfield` |0|Sin capacidad activa. |
| Base de poder `powerbase` |0|Sin fuerzas contratadas. |
| Restaurante `restaurant` |0|Sin capacidad activa. |
| Cueva `mine` |0|Sin capacidad activa. |
| Cripto `cryptomining` |0|Sin rigs activos. |
| Energía `powernet` |0|Sin suministro activo. |
| Vertido ilegal `flytipping` |0|Sin capacidad activa. |
| Embargos `repobusiness` |0|Sin capacidad activa. |
| Estadio `stadium` |0|Apuesta máxima0. |
| Hipódromo `horseracingstadium` |0|Sin caballos. |

La clasificación de Bóveda enII sigue el menú de la wiki, aunque el ID interno sea `mexicanvault`. Tabaco6 y coca3 son edificios familiares, no progreso propio deI/II. Los edificios deIII quedaron fuera de esta comparación.

El aeropuerto muestra23min y una investigación activa de reducción25%:30min×0.75=22.5min, redondeados en pantalla. Viaje de cash100000; no acelerar pagando diamantes. [Aeropuerto](https://es.mafiabattle.info/airport).

## Prioridades derivadas

1. **Mantener las fuentes ya automatizadas:** helicóptero, wheel/HiLo30min, ofertas weed y gemas. La wiki describe2–6diamantes para el helicóptero; no publica un intervalo fijo comprobado. No se confirmó un vuelo natural en esta inspección. [Diamantes gratis](https://es.mafiabattle.info/free-diamonds).
2. **Próximas ampliaciones a verificar en DOM:** reclamar cajas del almacén cuando sean realmente cobrables; entregas de transporte; actividad del laboratorio para puntos; ofertas de cigarros y colecciones. Son propuestas pendientes, no funciones activadas por esta investigación. El almacén puede dar diamantes junto con otros recursos, sin garantizar diamantes en cada caja. [Almacén](https://es.mafiabattle.info/warehouse), [Investigación](https://es.mafiabattle.info/research-lab).
3. **Resolver producción antes de más upgrades:** destilería llena; verificar suministro/estado real del bar durante su mejora. Al terminar a11, base400L/h de venta igualará400L/h de producción. Zona roja0/6 requiere investigar su ciclo propio antes de automatizar contratación. [Bar](https://es.mafiabattle.info/mafia-bar).
4. **Plan de avance:** Acero0 es el prerequisito que falta para Mansión23; wiki indicaAcero16/140Mcash/29d. No basta mirar los15–17M de cash: hay otros saldos, incluida bóveda, cuya retirada y riesgos no se evaluaron. No se lanzó ni canceló ninguna mejora. [Mansión](https://es.mafiabattle.info/mafia-mansion).
5. **Fábrica de diamantes:** los9315 mostrados requieren pago real; excluir de una estrategia de diamantes gratuitos. [Fábrica](https://es.mafiabattle.info/diamond-factory).

Las8/8plazas estaban ocupadas:3 investigaciones,2 mejoras y3 preparaciones de crímenes/autos. Recolecciones sin plaza continúan; el bot no cancela esas actividades para liberar plazas. El gimnasio espera una plaza disponible.

## Revisión delegada y límites

Gemini3.8FlashHigh analizóI yII en paralelo; ambos encargos finalizaron `SUCCESS`. Se integraron las propuestas tras contrastar fuentes y DOM. Se descartó trasladar fondos del banco para “desbloquear” la prensa: su capacidad es independiente. Se corrigió la base de Gemas19 a72000/h y no se asumió que11/12en el diálogo principal prueba una parcela libre. El saldo de bóveda y los IDs correctos surgieron en una lectura posterior.

Pruebas del cambio de salud:16Python+99Bun=115, `just check` correcto. Casos100→400 y99→409 comprobados con compras/confirmaciones simuladas; ejecución real a400 aún pendiente de que la vida llegue naturalmente al umbral. Servicio restaurado en `RUNNING`, cuenta correcta, sin incidencias en último status.

## Evolución — Pedidos semanales, Transporte y Scrap Yard

Matías aclara que cada pedido dispone de aproximadamente una semana para reunir la carga, y que al actual le quedan unas seis horas. Esto no es un plazo de una semana para completar todas las mejoras del imperio. Se deben usar las fechas y contadores del pedido real; la duración inicial de siete días queda informada por el usuario, pendiente observar una orden recién creada.

En esta inspección el mapa actual fue **Imperio II**, confirmado por `#imperium #swissbank`. Se consultaron los diálogos propios, se actualizó el inventario con su control nativo y se hicieron dos análisis paralelos Gemini3.8FlashHigh (`SUCCESS`). No se donaron recursos, reciclaron autos, compraron aceleraciones, retiraron fondos ni iniciaron mejoras.

### Pedido actual: producción normal insuficiente

La primera lectura mostró6h44m32s para expirar; la última6h38m. Premio mostrado: **11485000cash +12diamantes**, sujeto a éxito de la entrega.

| Requisito | Solicitado | Donado | Inventario comprobado | Falta antes de aportar |
|---|---:|---:|---:|---:|
| Weed |1480.5KG|0|999.66KG|480.84KG|
| XTC |267.3KG|0|164.20KG|103.10KG|
| Land Rover Discovery4, `car_36` |7|0|No confirmado|No calculable|
| White Gem, `gem_5` |3|0|No confirmado|No calculable|

XTC17 muestra **50KG/5h**, inventario máximo190KG. No había producciónXTC entre los8temporizadores activos; el botón del Lab inicia producción por50000cash y requiere una plaza. Solo cabe una tanda normal dentro de6h38m:164.2+50=214.2KG, inferior a267.3. Incluso el bono máximo teórico+50% de wiki dejaría239.2KG con una tanda; no se confirmó ese bono. **El pedido no es viable con la producción normal observada**, salvo una fuente adicional de XTC no verificada. No se intentó salvarlo gastando diamantes.

El tiempo de viaje es10h. La wiki distingue reunir la carga antes de expirar y realizar el transporte; no se rechaza un pedido solo porque el viaje dure más que el plazo restante de preparación. La llegada después del vencimiento de carga debe comprobarse al implementar un ciclo real. [Transporte](https://www.mafiabattle.info/transport-company), [XTC](https://www.mafiabattle.info/xtc-lab).

Para weed hay plantas maduras y otras que terminan durante el plazo. El depósito casi lleno impide cobrar tandas completas antes de liberar espacio. Como el encargo pide1480.5KG y el depósito admite1000, hacen falta aportes por etapas. XTC267.3 también supera su capacidad190. Por eso **esperar a tener el100% de todos los recursos simultáneamente en inventario sería una regla imposible**. La solución propuesta es comprobar viabilidad completa del pedido antes del primer aporte y después planificar aportes/producción, reservando los insumos restantes.

La lista de venta de la casa de empeño no devolvió un subdiálogo de inventario durante la consulta. No se dedujeron cantidades de autos ni gemas a partir de ofertas o colecciones: una medalla de haber obtenido un modelo no demuestra posesión actual. Los checks✔ del pedido son elementos visuales, no confirmación de inventario. La consulta terminó con cola vacía y ningún comando pendiente.

### Requisitos de progreso, comparados con el juego

| Mejora | Progreso real / requisito | Cash | Obra | Resultado útil |
|---|---|---:|---|---|
| Transporte9→10 |0/2entregas; faltan2|27M|4d|Permite XTC18 según requisito real del Lab. |
| Transporte10→11 |2entregas realizadas mientras esté en10, según wiki|30M|5d|Viaje9h; desbloqueos Petróleo/Acero según wiki. |
| XTC17→18 |Requiere Transporte10, DOM|68M, wiki|12d|Capacidad220KG, tanda60KG/5h base. |
| Scrap Yard4→5 |2/10reciclajes; faltan8|5M|5d|Producción17500→20000cash/h, capacidad570000→590000. |
| Acero0→1 |Transporte11 y30RP según wiki; actualmente14RP|30RP, control observado|No iniciada|Permite recibir acero en entregas. |

Los conteos de Transporte se hacen en el nivel anterior a la mejora: la fila10 de la wiki describe los requisitos para llegar a10 desde9. No se pide repetir las tres entregas de la fila9 para subir9→10. No mejorar mientras haya un transporte en curso: el diálogo real advierte que se cancelaría. [Transporte](https://www.mafiabattle.info/transport-company), [Acero](https://www.mafiabattle.info/steel-factory).

Hay aproximadamente16M en cash de bolsillo, por debajo de27M, pero existen saldos bancarios y de bóveda. No se asumió que se puedan retirar sin condiciones ni se movieron fondos. Transporte9→11 implica al menos9d solo de obras secuenciales, además de completar cuatro entregas y reunir cash: no es una promesa de avance en una semana.

### Scrap Yard: encargo, tiempo y coste de oportunidad

Encargo observado: **1Rolls-Royce Phantom (`car_46`), 2Cadillac Coupe DeVille (`car_58`) y3Chevrolet Aveo (`car_16`)**. Premio688764cash; duración3h y una plaza. No ofrece diamantes en este encargo. Los comandos nativos distinguen aportar, iniciar y acelerar; el botón de acelerar cobra diamantes y queda fuera del alcance.

Faltan8reciclajes para mejorar:24h de ciclos de una plaza, más120h de obra, es decir **mínimo teórico144h/6d**. No incluye obtener autos, liberar plazas, eventos, pausas ni futuras recetas distintas. Todos los8slots estaban ocupados:3investigaciones,2obras y3preparaciones crímenes/autos. No se canceló ninguna para empezar a reciclar.

El catálogo local ubica Phantom en robo12, DeVille en15 y Aveo en4. Sus valores base suman454378cash (236000+2×100000+3×6126), menos que el premio688764; esto **no prueba ganancia neta** porque faltan inventario, ofertas reales, tiempo de robo, salud y efecto en torneos. Se descartó la conclusión delegada de que el encargo era deficitario sin esos datos. El juego elige aleatoriamente el modelo dentro de cada opción; seleccionar la ubicación no garantiza conseguirlo. [Catálogo local](carros.md), [Robo de autos](https://es.mafiabattle.info/car-robbery).

La wiki indica que reciclar puede reducir puntuación en eventos/torneos. Se observó un evento de robo de autos próximo a comenzar; no se afirmó que Matías esté inscrito en todos los mini torneos listados. Completar la colección de armas de Scrap Yard puede dar500diamantes; no se garantiza arma ni premio de colección por cada reciclaje. [Scrap Yard](https://es.mafiabattle.info/scrap-yard).

### Resto de oportunidades del Imperio II

| Sistema | Situación | Próximo criterio |
|---|---|---|
| Destilería10 / Bar10 |4900L llenos; bar mejorándose a11,≈6d4h|Comprobar consumo y recoger cash. Base400L/h del bar11 igualará producción400L/h. |
| Almacén4 |Mejorándose,≈2d20h; no recibe cajas durante la obra|Activar recogida cuando termine y una caja sea cobrable; base5=48h. |
| Barcos6 |0/22barcos en diálogo principal; ofertas viejas no prueban stock|Robo/venta puede producir cash; verificar inventario antes de reciclar/vender. |
| Fábrica de diamantes5 |Stock9315 con retiro€4.99|Mantener fuera de estrategia gratuita. |
| Petróleo0 |Wiki desbloqueo Transporte11+3M|Preparar cadena de progreso, no comprar ahora. |
| Acero0 |Wiki Transporte11+30RP;faltan16RP frente a14actual|Reclamar actividad/investigar fuentes deRP antes de desbloquear. |
| Heroína0 / Moto Club0 |Wiki Heroína exigeBarcos15+10M; MotoClub exigeHeroína1+5M|Cadena distinta y de más largo plazo. |
| Restaurante0 |Wiki Transporte16+5M|No es desbloqueo inmediato de Transporte10. |
| Energía0 / Cripto0 |Energía exige Transporte20+15M según wiki|Posponer hasta cumplir dependencias y confirmar controles. |
| Base de poder0 |Wiki exige Mansión28+16M; actualMansión22|Objetivo lejano. |
| Cueva,Embargos,Vertido,Estadio,Hipódromo |Diálogos nivel0 en comparación previa|Requisitos y rentabilidad pendientes; no consumir recursos para abrirlos sin validarlos. |

[Petróleo](https://www.mafiabattle.info/oil-field), [Heroína](https://www.mafiabattle.info/heroin-lab), [Moto Club](https://www.mafiabattle.info/moto-club), [Restaurante](https://www.mafiabattle.info/restaurant), [Energía](https://www.mafiabattle.info/powernet-company), [Base de poder](https://www.mafiabattle.info/power-base).

También hay una oferta de cigarros precargada enI:94cigarros de weed por430520cash más28012para la familia;180cigarros en stock y≈3h22m de vigencia en esa lectura. No es una oferta de94diamantes. Produce180por3KG de tabaco en2h30m/una plaza; aditivos consumen18KG de weed/meth/XTC y deben respetar reservas del pedido. El medidor de actividad estaba37/148: aún no se confirmó un premio listo. Seguidores94/100: las ofertas indican mejora de4% al llegar100; adquisición no investigada.

### Próxima ampliación propuesta, aún no implementada

Un planificador de pedidos con fecha real, requisitos, aportes ya hechos, reservas de recursos/modelos, capacidad, producción pendiente y tiempo para reunir cada insumo. Priorizar robos de opciones asociadas a modelos faltantes por encima del dominio cuando exista un pedido viable; conservar el azar y no prometer un modelo por intento. Suspender ventas/aditivos que consuman recursos reservados. Reservar plazas para producción/reciclaje sin cancelar tareas, y agrupar visitasI/II considerando el coste100000 y espera23min del aeropuerto. Confirmar cada aporte y cobrar antes de reiniciar o mejorar; IDs de pedidos deben descubrirse en vivo, nunca reutilizar los de esta instantánea.

Primer alcance recomendado: **evaluar y preparar el próximo pedido**, mientras se mantiene la generación ya activa. Añadir Scrap Yard después de verificar inventarios, prioridades de autos y efecto de torneos. No se activaron automatismos de entregas, producciónXTC o reciclaje en esta investigación.

### Evidencia adicional: curación real a400

Durante la inspección el supervisor ya ejecutó el nuevo objetivo: el log confirma seis compras de50 y una de10,310000cash, salud94→404. Luego se observó416/453 por regeneración pasiva. Se conservaron presupuesto400000/ciclo y reserva100000. El servicio volvió a `RUNNING`/mati792 sin incidencias; no se bajó artificialmente la salud para probarlo.

Artefacto estructurado: `transport-scrap-2026-10-10.json`. Revisiones Gemini: Transporte `1f1d537a-c912-46e5-a9c1-5ad3761e2620`, Scrap `cbec8b06-fef5-4647-9a70-4d753e644c27`. Ambas `SUCCESS`; se corrigieron la regla imposible de tener todo el pedido simultáneamente en depósitos y la pérdida económica no demostrada. Última acción: persistir análisis y comprobar servicio; para continuar, verificar inventario propio de modelos/gemas y diseñar reservas/producción por etapas.
