const gameStart = ({ }) => {
    return (
        <div className="game-container">
            <h1 className="game-title">填字遊戲</h1>
            <div className="game-board">

            </div>
            <div className="button-container">
                <button className="start-button" whileHover={{ scale: 1.1 }}>
                    開始遊戲
                </button>
            </div>
        </div>
    );
};
export default gameStart;
