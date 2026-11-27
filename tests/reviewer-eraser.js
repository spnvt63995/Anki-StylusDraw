// Evaluate on an empty test card in Anki's reviewer. Each case clears its drawing.
(() => {
    const passed = [];
    const errors = [];
    const onError = e => errors.push(e.message);
    window.addEventListener('error', onError);
    function check(condition, message) {
        if (!condition) throw new Error(message);
    }
    function test(name, run) {
        clear_canvas();
        reset_drawing_modes();
        run();
        check(!errors.length, name + ': ' + errors.join(', '));
        passed.push(name);
    }
    function send(type, x, y, buttons, button, pressure, extra = {}, surface = secondary_canvas) {
        const rect = canvas.getBoundingClientRect();
        const event = new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 7, pointerType: 'pen', isPrimary: true,
            clientX: rect.left + canvas.clientLeft + x, clientY: rect.top + canvas.clientTop + y,
            buttons, button, pressure, ...extra
        });
        surface.dispatchEvent(event);
        return event;
    }
    function stroke(points, buttons = 1, button = 0, extra = {}, surface = secondary_canvas) {
        const [first, ...moves] = points;
        send('pointerdown', ...first, buttons, button, .6, extra, surface);
        for (const point of moves) send('pointermove', ...point, buttons, -1, .6, extra, surface);
        send('pointerup', ...points[points.length - 1], 0, button, 0, extra, surface);
    }
    const horizontal = [[75, 80], [85, 80], [95, 80], [105, 80], [115, 80], [125, 80]];
    const crossing = [[103, 60], [103, 78], [103, 97]];
    function inkCount() {
        return lineHistory.filter(a => a.type !== 'D' && a.visible).length;
    }
    function history(...types) {
        check(lineHistory.map(a => a.type).join() === types.join(), 'unexpected history: ' + lineHistory.map(a => a.type));
    }
    try {
        for (const mode of ['L', 'P', 'C']) {
            test('eraser, undo, redo and next tip in ' + mode, () => {
                if (mode === 'P') switch_perfect_freehand();
                if (mode === 'C') switch_calligraphy_mode();
                stroke(horizontal, 1, 0, {}, canvas);
                stroke(crossing, 32, 5);
                history(mode, 'D');
                check(!inkCount() && lineHistory[1].deletedList.join() === '0', 'first stroke survived');
                ts_undo(); check(inkCount() === 1, 'undo');
                ts_redo(); check(!inkCount(), 'redo');
                stroke(horizontal); history(mode, 'D', mode);
                check(inkCount() === 1 && !strokeDelete, 'selected pen was lost');
            });
        }
        test('two reported eraser contacts followed by a normal tip', () => {
            stroke(horizontal);
            stroke(horizontal.map(([x,y]) => [x,y+45]));
            stroke(crossing,32,5);
            stroke(crossing.map(([x,y]) => [x,y+45]),32,5);
            stroke(horizontal); history('L','L','D','D','L');
            check(inkCount() === 1, 'stale eraser');
        });
        test('tool stays fixed during contact and ignores other pointers', () => {
            stroke(horizontal);
            send('pointerdown',100,65,32,5,.6);
            stroke(horizontal,1,0,{pointerId:1,pointerType:'mouse'});
            send('pointermove',102,88,1,0,.6);
            send('pointerup',102,95,0,0,0);
            send('pointerdown',80,60,1,0,.6);
            send('pointermove',100,80,32,5,.6);
            send('pointerup',110,90,0,5,0);
            history('L','D','L'); check(inkCount() === 1,'tool or pointer switched');
        });
        test('hover changes nothing and a barrel held across tip lifts starts separate contacts', () => {
            stroke(horizontal);
            send('pointermove',100,85,0,-1,0);
            send('pointermove',100,80,32,-1,0);
            send('pointerdown',100,85,2,2,0);
            send('pointermove',100,80,2,-1,0);
            send('pointerup',100,80,0,2,0);
            history('L'); check(inkCount() === 1,'hover erased');
            stroke(horizontal.map(([x,y]) => [x,y+45]));
            send('pointerdown',95,70,2,2,0);
            send('pointermove',100,80,3,0,.6);
            send('pointermove',100,125,2,0,0); // hover across the second stroke
            history('L','L','D'); check(inkCount() === 1,'hover bridge');
            send('pointermove',100,125,3,0,.6);
            send('pointerup',100,125,0,2,0);
            history('L','L','D','D'); check(!inkCount(),'second barrel contact missed');
        });
        test('tap, collinear wipe and off-canvas release', () => {
            stroke(horizontal); stroke([[97,80]],32,5);
            stroke(horizontal); stroke([[80,80],[115,80]],32,5);
            stroke(horizontal); send('pointerdown',103,55,32,5,.5);
            send('pointerup',103,100,0,5,0,{},window);
            history('L','D','L','D','L','D'); check(!inkCount(),'hit geometry');
        });
        test('combined button bits erase two strokes in one undo', () => {
            stroke(horizontal); stroke(horizontal.map(([x,y]) => [x,y+25]));
            stroke([[103,68],[103,116]],33,5);
            history('L','L','D'); check(lineHistory[2].deletedList.join() === '0,1','multiple hits');
            ts_undo(); check(inkCount() === 2,'grouped undo');
            ts_redo(); check(!inkCount(),'grouped redo');
        });
        test('Qt eraser tip press without pressure samples', () => {
            stroke(horizontal);
            send('pointerdown',100,66,32,5,0);
            send('pointermove',100,82,0,-1,0);
            send('pointerup',100,94,0,5,0);
            history('L','D'); check(!inkCount(),'pressure-less eraser');
        });
        test('cancellation clears the guide and leaves the ink', () => {
            stroke(horizontal);
            for (const type of ['pointercancel','lostpointercapture','blur']) {
                send('pointerdown',100,60,32,5,.5);
                send('pointermove',100,94,32,-1,.5);
                if (type === 'blur') window.dispatchEvent(new Event('blur'));
                else send(type,100,94,0,-1,0);
                send('pointerup',100,94,0,5,0);
                history('L'); check(!isPointerDown && inkCount() === 1, 'cancellation: ' + type);
                const p=secondary_ctx.getImageData(100*devicePixelRatio,80*devicePixelRatio,1,1).data;
                check(!p[3], 'guide remained after ' + type);
            }
        });
        test('empty erase preserves redo and clear protects previous side', () => {
            stroke(horizontal); stroke(crossing,32,5); ts_undo();
            stroke([[100,150]],32,5); ts_redo(); history('L','D'); check(!inkCount(),'redo lost');
            ts_undo(); add_clear_marker(); stroke(horizontal); stroke(crossing,32,5);
            check(lineHistory[0].visible && lineHistory[3].deletedList.join() === '2','erased past clear');
        });
        test('mouse, touch, toolbar eraser and keyboard hold', () => {
            stroke(horizontal,1,0,{pointerId:2,pointerType:'touch'});
            stroke(crossing,2,2,{pointerId:1,pointerType:'mouse'}); history('L','L');
            switch_stroke_delete_mode(); stroke(crossing); check(strokeDelete && !inkCount(),'toolbar eraser');
            switch_stroke_delete_mode(); stroke(horizontal);
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'d',shiftKey:true,bubbles:true}));
            send('pointerdown',100,60,1,0,.5); send('pointermove',100,95,1,-1,.5);
            document.dispatchEvent(new KeyboardEvent('keyup',{key:'d',bubbles:true}));
            send('pointerup',100,95,0,0,0);
            check(!strokeDelete && !inkCount(),'keyboard hold');
        });
        test('text entry survives temporary erasing', () => {
            stroke(horizontal); switch_text_writing_mode();
            stroke(crossing,32,5); history('L','D'); check(textWriting && !inkCount(),'text mode lost');
            stroke([[125,130]]); textBox.value='test'; textBox.dispatchEvent(new Event('input'));
            submitCurrentText(); history('L','D','T'); check(lineHistory[2].text === 'test','text entry');
        });
        test('pressure setting, barrel mapping and scoped context menu', () => {
            const saved = pressureSensitivity;
            try {
                pressureSensitivity=false;
                stroke(horizontal); stroke(crossing,2,2); history('L','D'); check(!inkCount(),'barrel lost');
                check(send('contextmenu',100,80,2,2,0).defaultPrevented,'pen menu');
                check(!send('contextmenu',100,80,2,2,0,{pointerType:'mouse',pointerId:1}).defaultPrevented,'mouse menu');
                check(!send('contextmenu',100,80,2,2,0,{},document.body).defaultPrevented,'outside canvas');
            } finally { pressureSensitivity=saved; }
        });
        return passed;
    } finally {
        window.removeEventListener('error', onError);
        clear_canvas(); reset_drawing_modes();
    }
})();
