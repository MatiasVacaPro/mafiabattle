import pyautogui as pg 

billonari_club_options = [(881, 396), (889, 481), (885, 561)]
billonari_club_index = 0

def bucle_temporizador_7():
    """Temporizador 6: Billonari Club — una iteración por llamada"""
    global billonari_club_index
    log_msg("Billonari Club", "espera", "Esperando turno para hacer click...")
    with action_lock:
        time.sleep(1.5)
        log_msg("Billonari Club", "ejecutando", "Ejecutando secuencia de clicks...")
        pg.doubleClick(x=740, y=967)
        time.sleep(1)
        pg.doubleClick(x=739, y=309)
        time.sleep(1)


        # Click aleatorio en eje X, Y siempre es 775
        random_x = random.randint(502, 684)
        pg.doubleClick(x=random_x, y=772)
        time.sleep(1)

        # Click secuencial ordenado
        opt_x, opt_y = billonari_club_options[billonari_club_index % len(billonari_club_options)]
        pg.doubleClick(x=opt_x, y=opt_y)
        billonari_club_index += 1
        time.sleep(1)

        time.sleep(0.5)
        pg.press('escape')
        pg.press('escape')
        pg.press('escape')
        log_msg("Billonari Club", "completado", "Secuencia completada. Iniciando espera de 8 minutos.")
