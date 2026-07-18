let mouseX = 0;
let mouseY = 0;

let lerpedX = 0;
let lerpedY = 0;

document.addEventListener("mousemove", e => {
    mouseX = e.clientX / window.innerWidth * 20 - 10;
    mouseY = e.clientY / window.innerHeight * 20 - 10;
});

const tweets = document.querySelectorAll(".whoscripting");

function update() {
    lerpedX += (mouseX - lerpedX) * 0.05;
    lerpedY += (mouseY - lerpedY) * 0.05;

    tweets.forEach(tweet => {
        tweet.style.transform =
            `translate(${lerpedX}px, ${lerpedY}px) rotate(${lerpedX * 0.15}deg)`;
    });

    requestAnimationFrame(update);
}

update();